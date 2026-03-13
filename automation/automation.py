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
from datetime import datetime


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


def main():
    parser = argparse.ArgumentParser(description='PharmaFlow Automation Scripts')
    parser.add_argument('--action', required=True,
                        choices=['create-user', 'create-business', 'list-users',
                                 'list-businesses', 'backup'],
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


if __name__ == '__main__':
    main()
