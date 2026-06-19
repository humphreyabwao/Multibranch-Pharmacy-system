"""
PharmaFlow - Python Automation Module
Provides automation scripts for:
  - Firebase Admin SDK setup (user creation, role assignment)
  - Inventory alerts
  - Report generation helpers
  - Data backup utilities

Prerequisites:
  pip install -r requirements.txt

Usage:
  python automation.py --action <action_name> [options]
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone


def get_firebase_admin():
    """Lazy import firebase_admin to allow script to load without it installed."""
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore, auth
        return firebase_admin, credentials, firestore, auth
    except ImportError:
        print("Error: firebase-admin package not installed.")
        print("Run: pip install firebase-admin")
        sys.exit(1)


def init_firebase(service_account_path):
    """Initialize Firebase Admin SDK with service account credentials."""
    firebase_admin, credentials, firestore, auth = get_firebase_admin()

    if not os.path.isfile(service_account_path):
        print(f"Error: Service account file not found: {service_account_path}")
        print("Download it from Firebase Console > Project Settings > Service Accounts")
        sys.exit(1)

    cred = credentials.Certificate(service_account_path)

    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)

    db = firestore.client()
    return db, auth


def create_user(db, auth_module, email, password, display_name, role, business_id=None):
    """Create a new user in Firebase Auth and Firestore."""
    try:
        # Create in Firebase Auth
        user_record = auth_module.create_user(
            email=email,
            password=password,
            display_name=display_name
        )

        # Create profile document in Firestore
        user_data = {
            'email': email,
            'displayName': display_name,
            'role': role,
            'businessId': business_id,
            'createdAt': datetime.utcnow().isoformat(),
            'active': True
        }

        db.collection('users').document(user_record.uid).set(user_data)

        print(f"User created successfully:")
        print(f"  UID: {user_record.uid}")
        print(f"  Email: {email}")
        print(f"  Role: {role}")
        if business_id:
            print(f"  Business ID: {business_id}")

        return user_record.uid

    except Exception as e:
        print(f"Error creating user: {e}")
        return None


def create_business(db, name, address, phone, license_number):
    """Create a new business (franchise) in Firestore."""
    try:
        business_data = {
            'name': name,
            'address': address,
            'phone': phone,
            'licenseNumber': license_number,
            'createdAt': datetime.utcnow().isoformat(),
            'active': True
        }

        doc_ref = db.collection('businesses').add(business_data)
        business_id = doc_ref[1].id

        print(f"Business created successfully:")
        print(f"  ID: {business_id}")
        print(f"  Name: {name}")

        return business_id

    except Exception as e:
        print(f"Error creating business: {e}")
        return None


def list_users(db):
    """List all users from Firestore."""
    try:
        users = db.collection('users').stream()
        print(f"\n{'UID':<30} {'Email':<30} {'Name':<25} {'Role':<12} {'Business':<20}")
        print("-" * 117)
        for user in users:
            data = user.to_dict()
            print(f"{user.id:<30} {data.get('email', ''):<30} {data.get('displayName', ''):<25} {data.get('role', ''):<12} {data.get('businessId', 'N/A'):<20}")
    except Exception as e:
        print(f"Error listing users: {e}")


def list_businesses(db):
    """List all businesses from Firestore."""
    try:
        businesses = db.collection('businesses').stream()
        print(f"\n{'ID':<25} {'Name':<30} {'Phone':<18} {'License':<20} {'Active'}")
        print("-" * 100)
        for biz in businesses:
            data = biz.to_dict()
            print(f"{biz.id:<25} {data.get('name', ''):<30} {data.get('phone', ''):<18} {data.get('licenseNumber', ''):<20} {data.get('active', True)}")
    except Exception as e:
        print(f"Error listing businesses: {e}")


def backup_collection(db, collection_name, output_dir="backups"):
    """Backup a Firestore collection to a JSON file."""
    try:
        os.makedirs(output_dir, exist_ok=True)
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename = f"{collection_name}_{timestamp}.json"
        filepath = os.path.join(output_dir, filename)

        docs = db.collection(collection_name).stream()
        data = {}
        for doc in docs:
            data[doc.id] = doc.to_dict()

        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2, default=str)

        print(f"Backup saved to: {filepath}")
        print(f"Documents backed up: {len(data)}")

    except Exception as e:
        print(f"Error backing up collection: {e}")


def _as_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _batch_sort_key(batch):
    expiry = _as_datetime(batch.get('expiryDate'))
    received = _as_datetime(batch.get('addedAt'))
    return (
        expiry or datetime.max.replace(tzinfo=timezone.utc),
        received or datetime.min.replace(tzinfo=timezone.utc),
        str(batch.get('batchNumber') or '')
    )


def inspect_inventory_product(product_id, product):
    """Return canonical quantities and integrity issues for one inventory item."""
    stored_qty = max(0, int(product.get('quantity') or 0))
    raw_batches = product.get('stockBatches')
    batches = list(raw_batches) if isinstance(raw_batches, list) else []

    if not batches and stored_qty > 0:
        batches = [{
            'batchNumber': product.get('batchNumber') or product.get('sku') or '',
            'quantity': stored_qty,
            'expiryDate': product.get('expiryDate'),
            'buyingPrice': product.get('buyingPrice') or 0,
            'sellingPrice': product.get('sellingPrice') or 0,
            'minimumSellPrice': product.get('minimumSellPrice') or product.get('buyingPrice') or 0,
            'addedAt': product.get('createdAt') or product.get('updatedAt'),
            'legacy': True
        }]

    normalized = []
    issues = []
    seen_batches = set()
    duplicate_batches = set()
    now = datetime.now(timezone.utc)

    for index, batch in enumerate(batches):
        qty = int(batch.get('quantity') or 0)
        if qty < 0:
            issues.append(f'batch[{index}] has negative quantity {qty}')
            qty = 0
        if qty == 0:
            continue
        number = str(batch.get('batchNumber') or '').strip()
        if not number:
            issues.append(f'batch[{index}] has no batch number')
        elif number in seen_batches:
            duplicate_batches.add(number)
        seen_batches.add(number)
        normalized.append({**batch, 'batchNumber': number, 'quantity': qty})

    if duplicate_batches:
        issues.append('duplicate batch number(s): ' + ', '.join(sorted(duplicate_batches)))

    normalized.sort(key=_batch_sort_key)
    batch_qty = sum(int(batch.get('quantity') or 0) for batch in normalized)
    sellable = []
    expired_qty = 0
    for batch in normalized:
        expiry = _as_datetime(batch.get('expiryDate'))
        if expiry and expiry <= now:
            expired_qty += int(batch.get('quantity') or 0)
        else:
            sellable.append(batch)

    if stored_qty != batch_qty:
        issues.append(f'quantity mismatch: stored={stored_qty}, batches={batch_qty}')
    if expired_qty:
        issues.append(f'{expired_qty} expired unit(s) remain in inventory')

    primary = sellable[0] if sellable else None
    return {
        'productId': product_id,
        'name': product.get('name') or '',
        'sku': product.get('sku') or '',
        'storedQuantity': stored_qty,
        'batchQuantity': batch_qty,
        'sellableQuantity': sum(int(batch.get('quantity') or 0) for batch in sellable),
        'expiredQuantity': expired_qty,
        'issues': issues,
        'normalizedBatches': normalized,
        'primaryBatchNumber': (primary or {}).get('batchNumber') or '',
        'primaryExpiryDate': (primary or {}).get('expiryDate')
    }


def inventory_audit(db, business_id=None, repair=False, output_dir="audit_reports"):
    """
    Audit every inventory document. With --repair, only deterministic metadata is
    repaired: negative batches are removed, quantity becomes the batch sum, and
    primary batch/expiry fields are recalculated. Expired stock is reported but
    remains for the application's transactional quarantine workflow.
    """
    os.makedirs(output_dir, exist_ok=True)
    businesses = [db.collection('businesses').document(business_id).get()] if business_id \
        else list(db.collection('businesses').stream())
    report = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'repairRequested': repair,
        'businesses': [],
        'summary': {'products': 0, 'productsWithIssues': 0, 'repairs': 0}
    }

    for business in businesses:
        if not business.exists:
            print(f"Business not found: {business_id}")
            continue
        business_data = business.to_dict() or {}
        branch_report = {
            'businessId': business.id,
            'businessName': business_data.get('name') or business.id,
            'products': []
        }
        inventory_ref = db.collection('businesses').document(business.id).collection('inventory')
        for product_doc in inventory_ref.stream():
            result = inspect_inventory_product(product_doc.id, product_doc.to_dict() or {})
            report['summary']['products'] += 1
            if result['issues']:
                report['summary']['productsWithIssues'] += 1
                branch_report['products'].append({
                    key: value for key, value in result.items() if key != 'normalizedBatches'
                })
                if repair:
                    product_doc.reference.update({
                        'quantity': result['batchQuantity'],
                        'stockBatches': result['normalizedBatches'],
                        'batchNumber': result['primaryBatchNumber'],
                        'expiryDate': result['primaryExpiryDate'],
                        'integrityRepairedAt': datetime.now(timezone.utc),
                        'integrityRepairSource': 'automation_inventory_audit'
                    })
                    report['summary']['repairs'] += 1
        report['businesses'].append(branch_report)

    timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    path = os.path.join(output_dir, f'inventory_audit_{timestamp}.json')
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, indent=2, default=str)

    summary = report['summary']
    print(f"Inventory audit complete: {summary['products']} products checked")
    print(f"Products with issues: {summary['productsWithIssues']}")
    print(f"Repairs applied: {summary['repairs']}")
    print(f"Report: {path}")
    return report


def main():
    parser = argparse.ArgumentParser(description='PharmaFlow Automation Scripts')
    parser.add_argument('--action', required=True,
                        choices=['create-user', 'create-business', 'list-users',
                                 'list-businesses', 'backup', 'inventory-audit'],
                        help='Action to perform')
    parser.add_argument('--service-account', default='serviceAccountKey.json',
                        help='Path to Firebase service account key JSON file')

    # User creation args
    parser.add_argument('--email', help='User email')
    parser.add_argument('--password', help='User password')
    parser.add_argument('--name', help='Display name / Business name')
    parser.add_argument('--role', choices=['superadmin', 'admin', 'staff'],
                        help='User role')
    parser.add_argument('--business-id', help='Business ID to assign user to')

    # Business creation args
    parser.add_argument('--address', help='Business address')
    parser.add_argument('--phone', help='Business phone')
    parser.add_argument('--license', help='Business license number')

    # Backup args
    parser.add_argument('--collection', help='Firestore collection to backup')
    parser.add_argument('--repair', action='store_true',
                        help='Apply deterministic inventory metadata repairs')

    args = parser.parse_args()

    db, auth_module = init_firebase(args.service_account)

    if args.action == 'create-user':
        if not all([args.email, args.password, args.name, args.role]):
            print("Error: --email, --password, --name, and --role are required for create-user")
            sys.exit(1)
        create_user(db, auth_module, args.email, args.password,
                     args.name, args.role, args.business_id)

    elif args.action == 'create-business':
        if not args.name:
            print("Error: --name is required for create-business")
            sys.exit(1)
        create_business(db, args.name, args.address or '', args.phone or '', args.license or '')

    elif args.action == 'list-users':
        list_users(db)

    elif args.action == 'list-businesses':
        list_businesses(db)

    elif args.action == 'backup':
        if not args.collection:
            print("Error: --collection is required for backup")
            sys.exit(1)
        backup_collection(db, args.collection)

    elif args.action == 'inventory-audit':
        inventory_audit(db, business_id=args.business_id, repair=args.repair)


if __name__ == '__main__':
    main()
