# PharmaFlow — Multibranch Pharmacy Management System

<p align="center">
  <img src="https://img.shields.io/badge/Firebase-v10.12-FFCA28?logo=firebase&logoColor=white" alt="Firebase">
  <img src="https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/Python-3.x-3776AB?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/License-Proprietary-blue" alt="License">
</p>

**PharmaFlow** is a comprehensive, cloud-based multi-branch pharmacy management system built with vanilla JavaScript and Firebase. It supports distributed pharmacy operations with real-time data synchronization, role-based access control, franchise management, and a full suite of pharmacy workflows — from point-of-sale to regulatory compliance.

> **Live Demo:** [https://multitenant-pharamcy-system.web.app](https://multitenant-pharamcy-system.web.app)

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Modules](#modules)
- [User Roles & Permissions](#user-roles--permissions)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Firebase Setup](#firebase-setup)
- [Deployment](#deployment)
- [Python Automation](#python-automation)
- [Security](#security)
- [Configuration](#configuration)
- [Contributing](#contributing)

---

## Features

### Core Capabilities
- **Multi-Branch / Franchise Support** — Manage multiple pharmacy branches under one system with full data isolation per business
- **Real-Time Sync** — All data updates in real-time via Firestore listeners across devices and tabs
- **Role-Based Access Control** — Superadmin, Admin, and Staff roles with granular per-module permissions
- **Offline Support** — Firestore persistence enabled for uninterrupted workflow during connectivity issues
- **Dark/Light Theme** — Toggle between themes with preference saved per user

### Business Operations
- **Point of Sale (POS)** — Fast product search, cart management, discounts, multiple payment methods (Cash, M-Pesa, Card), receipt printing
- **Inventory Management** — 60+ drug categories, stock tracking, expiry alerts, low-stock notifications, batch import/export
- **Patient Management** — Registration, medical records, multi-service billing, invoice generation
- **Prescription Management** — Digital prescriptions with drug selection from inventory, print-friendly output
- **Wholesale / B2B Sales** — Multi-item wholesale orders, professional invoicing, delivery rider assignment
- **Purchase Orders** — Create and track supplier purchase orders through draft → submitted → approved → received workflow
- **Expense Tracking** — 16 expense categories, approval workflows, payment method logging
- **Supplier Directory** — Full supplier CRUD with contact, bank details, and payment terms

### Compliance & Analytics
- **DDA Register** — Dangerous Drugs Act compliance with sales logging and prescription document uploads
- **Medication Refill Scheduling** — Chronic medication refill management with automated reminders
- **Activity Logs** — Full audit trail with 16 log categories and 6 severity levels
- **Reports** — Sales analytics, expense breakdowns, inventory reports, P&L statements with CSV/PDF export
- **Accounts Module** — Income tracking, expense analysis, reconciliation, and profit & loss statements

### Administration
- **Admin Panel** — User management, franchise creation/deactivation, role & permission assignment
- **Dynamic Branding** — Configurable business name, tagline, logo, receipt/invoice footers per franchise
- **Settings** — Currency, locale, timezone, notification thresholds, and system preferences
- **Rider Dashboard** — Dedicated mobile-optimized delivery interface for wholesale orders

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vanilla JavaScript (ES6+), Custom CSS (SPA architecture) |
| **Backend** | Firebase (Auth, Firestore, Storage, Hosting) |
| **Icons** | Font Awesome 6.5.1 |
| **SDK** | Firebase JavaScript SDK 10.12.0 |
| **Automation** | Python 3.x with Firebase Admin SDK |
| **Hosting** | Firebase Hosting with CDN |

---

## Architecture

### Single Page Application (SPA)
PharmaFlow is a modular SPA where each feature is a self-contained module under the `PharmaFlow` namespace:

```
PharmaFlow.Dashboard
PharmaFlow.POS
PharmaFlow.Inventory
PharmaFlow.Patients
PharmaFlow.Settings
...
```

### Module Pattern
Every module follows a consistent structure:

```javascript
(function () {
    'use strict';
    window.PharmaFlow = window.PharmaFlow || {};

    const ModuleName = {
        init() { /* bind listeners, render UI */ },
        cleanup() { /* unsubscribe Firestore listeners */ },
        // ... feature methods
    };

    window.PharmaFlow.ModuleName = ModuleName;
})();
```

### Routing
- The `Router` module listens for `navigate` custom events with `moduleId` and `subModuleId`
- Content is rendered dynamically into `#app-wrapper`
- Modules with sub-features render as tabbed interfaces
- Breadcrumbs display page hierarchy for navigation context

### Multi-Tenancy Model
- **Superadmin**: Access all businesses via a franchise selector
- **Admin**: Full access scoped to their assigned `businessId`
- **Staff**: Limited access within their assigned business
- All Firestore queries are scoped by `businessId` to enforce data isolation

### Real-Time Data Flow
```
Firestore Collection ──onSnapshot()──► Module State ──render()──► DOM
         ▲                                                          │
         └──────────── add/update/delete ◄──────── User Action ◄────┘
```

---

## Modules

| Module | File | Sub-Modules | Description |
|--------|------|-------------|-------------|
| **Dashboard** | `dashboard.js` | — | 10 real-time stat cards, quick actions, global search, activity feed |
| **POS** | `pos.js` | — | Product search, cart, discounts, payments, receipt printing |
| **Today's Sales** | `todays-sales.js` | — | Daily sales summary with real-time updates |
| **All Sales** | `all-sales.js` | — | Full sales history with search, filter, pagination, export |
| **Prescription** | `prescription.js` | — | Digital prescriptions, drug selection, print preview |
| **Inventory** | `inventory.js` | View, Add | Product catalog, stock management, batch import/export |
| **DDA Register** | `dda-register.js` | Register, Sales, Prescriptions | Controlled drug compliance & audit |
| **Medication Refill** | `medication-refill.js` | Overview, Add, Manage, Reminders | Chronic medication scheduling |
| **My Orders** | `my-orders.js` | Create, Manage, History, Stock History | Supplier purchase orders |
| **Supplier** | `supplier.js` | — | Supplier directory management |
| **Wholesale** | `wholesale.js` | Create, Manage, Client Leads, Riders | B2B sales, invoicing, delivery |
| **Patients** | `patients.js` | Add, Manage, Billing, Manage Billing | Patient records & invoicing |
| **Expenses** | `expense.js` | Add, Manage | Expense recording & approval |
| **Accounts** | `accounts.js` | Overview, Income, Expenses, Reconciliation, P&L | Financial management |
| **Reports** | `reports.js` | — | Analytics, export (CSV/PDF), P&L statements |
| **Activity Logs** | `activity-logs.js` | All, User, System Alerts | Comprehensive audit trail |
| **Admin Panel** | `admin-panel.js` | Dashboard, Users, Franchises | User & business management |
| **Settings** | `settings.js` | — | Branding, localization, notifications, preferences |
| **Rider Dashboard** | `rider.html` | — | Standalone delivery tracking interface |

---

## User Roles & Permissions

### Role Hierarchy

| Role | Scope | Capabilities |
|------|-------|-------------|
| **Superadmin** | All businesses | Full system access, franchise management, cross-business analytics |
| **Admin** | Assigned business | User management, settings, approvals, full module access |
| **Staff** | Assigned business | Day-to-day operations based on granted permissions |

### Granular Permissions
Admins can assign module-level and sub-module-level permissions per user:

```
dashboard, pharmacy, pharmacy:pos, pharmacy:today-sales, pharmacy:all-sales,
pharmacy:prescription, inventory, inventory:view, inventory:add, patients,
patients:add, patients:manage, patients:billing, expenses, reports, accounts,
wholesale, supplier, dda-register, medication-refill, activity-logs, admin-panel
```

Users with no permissions array assigned get access to all modules (backward compatibility).

---

## Project Structure

```
├── index.html                  # Main SPA entry point
├── login.html                  # Authentication page
├── rider.html                  # Delivery rider dashboard
├── firebase.json               # Firebase hosting & services config
├── .firebaserc                 # Firebase project alias
│
├── js/
│   ├── firebase-config.js      # Firebase SDK initialization
│   ├── app.js                  # App bootstrap & module loader
│   ├── auth.js                 # Authentication & session management
│   ├── router.js               # SPA routing engine
│   ├── sidebar.js              # Navigation sidebar with role filtering
│   ├── dashboard.js            # Dashboard stats & widgets
│   ├── pos.js                  # Point of Sale
│   ├── todays-sales.js         # Daily sales view
│   ├── all-sales.js            # Sales history & export
│   ├── prescription.js         # Prescription management
│   ├── inventory.js            # Inventory management
│   ├── patients.js             # Patient records & billing
│   ├── dda-register.js         # DDA compliance register
│   ├── medication-refill.js    # Chronic medication refills
│   ├── my-orders.js            # Purchase orders
│   ├── supplier.js             # Supplier management
│   ├── wholesale.js            # Wholesale / B2B sales
│   ├── expense.js              # Expense tracking
│   ├── accounts.js             # Accounting & P&L
│   ├── reports.js              # Analytics & reports
│   ├── activity-logs.js        # Audit trail
│   ├── admin-panel.js          # Admin & franchise management
│   └── settings.js             # System settings & branding
│
├── css/
│   └── styles.css              # Application styles (light/dark themes)
│
├── images/
│   └── pharma.jpg              # Login page background
│
├── firebase/
│   ├── firestore.rules         # Firestore security rules
│   └── storage.rules           # Cloud Storage security rules
│
└── automation/
    ├── automation.py            # Python admin automation scripts
    └── requirements.txt         # Python dependencies
```

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (for Firebase CLI)
- [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`)
- A [Firebase project](https://console.firebase.google.com/) with Firestore, Auth, and Hosting enabled
- Python 3.x (optional, for automation scripts)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/humphreyabwao/Multibranch-Pharmacy-system.git
   cd Multibranch-Pharmacy-system
   ```

2. **Configure Firebase**
   
   Update `js/firebase-config.js` with your Firebase project credentials:
   ```javascript
   const firebaseConfig = {
       apiKey: "YOUR_API_KEY",
       authDomain: "YOUR_PROJECT.firebaseapp.com",
       projectId: "YOUR_PROJECT_ID",
       storageBucket: "YOUR_PROJECT.appspot.com",
       messagingSenderId: "YOUR_SENDER_ID",
       appId: "YOUR_APP_ID"
   };
   ```

3. **Login to Firebase CLI**
   ```bash
   firebase login
   ```

4. **Link to your project**
   ```bash
   firebase use YOUR_PROJECT_ID
   ```

5. **Serve locally**
   ```bash
   firebase serve
   ```
   Open [http://localhost:5000](http://localhost:5000) in your browser.

---

## Firebase Setup

### Required Firebase Services
1. **Authentication** — Enable Email/Password sign-in method
2. **Cloud Firestore** — Create database in production mode
3. **Cloud Storage** — Enable for DDA prescription uploads and profile photos
4. **Hosting** — Enabled by default with Firebase CLI

### Firestore Indexes
The application uses composite queries that may require custom indexes. Firebase will prompt you with index creation links in the browser console when needed.

### Initial Data
Use the Python automation script to bootstrap your first superadmin user and business:
```bash
cd automation
pip install -r requirements.txt
python automation.py
```

---

## Deployment

Deploy everything to Firebase:

```bash
# Deploy hosting, Firestore rules, and Storage rules
firebase deploy

# Deploy only hosting
firebase deploy --only hosting

# Deploy only security rules
firebase deploy --only "firestore,storage"
```

The app will be available at:
- `https://YOUR_PROJECT.web.app`
- `https://YOUR_PROJECT.firebaseapp.com`

---

## Python Automation

The `automation/` folder contains admin utilities powered by Firebase Admin SDK:

| Feature | Description |
|---------|-------------|
| **User Creation** | Programmatically create users with roles |
| **Business Management** | Create and configure franchise/branch records |
| **Collection Backup** | Export Firestore collections for backup |
| **Inventory Alerts** | Automated low-stock and expiry notifications |
| **Report Generation** | Scheduled report helpers |

### Setup
```bash
cd automation
pip install -r requirements.txt
```

Requires a Firebase service account key JSON file. See [Firebase Admin SDK docs](https://firebase.google.com/docs/admin/setup).

---

## Security

### Authentication
- Firebase Authentication with email/password
- Offline persistence with multi-tab synchronization
- Disabled account detection prevents login
- Auto-provisioning of user profiles on first login

### Firestore Security Rules
- All operations require authentication (`request.auth != null`)
- Business isolation: users can only access data within their `businessId`
- Role-based write restrictions (e.g., only admins can delete inventory)
- Superadmin bypass for cross-business operations
- Helper functions: `isSuperAdmin()`, `isAdminOrAbove()`, `belongsToBusiness()`

### Storage Security Rules
- DDA prescription uploads: max 5MB, images and PDFs only
- Profile photos: max 2MB, images only
- Business-scoped file paths

### Data Protection
- HTTPS enforced via Firebase Hosting
- No sensitive data stored in localStorage (only branding/theme preferences)
- Firestore rules enforce server-side validation

---

## Configuration

### Dynamic Branding
All branding is configurable per franchise via the Settings module:

| Setting | Default | Description |
|---------|---------|-------------|
| Business Name | PharmaFlow | Displayed in sidebar, receipts, invoices |
| Tagline | Pharmacy Management System | Shown on login page |
| Logo Icon | `fas fa-capsules` | 12 icon options available |
| Receipt Footer | Thank you for your purchase! | Printed on POS receipts |
| Invoice Footer | Thank you for your business! | Printed on wholesale/patient invoices |

### Localization

| Setting | Options |
|---------|---------|
| **Currency** | KSH, USD, EUR, GBP, TZS, UGX, NGN, ZAR |
| **Locale** | en-KE, en-US, en-GB, sw-KE, fr-FR, pt-BR, en-NG, en-ZA |
| **Date Format** | DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD |
| **Timezone** | Africa/Nairobi, UTC, America/New_York, Europe/London, Asia/Dubai |

### Notification Thresholds

| Alert | Default | Description |
|-------|---------|-------------|
| Low Stock | 10 units | Triggers low-stock warnings on dashboard |
| Expiry Warning | 30 days | Flags products expiring within threshold |

---

## ID Formats

All records use human-readable IDs with embedded dates:

| Record | Format | Example |
|--------|--------|---------|
| Sale | `SL-YYMMDD-XXXXX` | SL-260313-A3F7B |
| Prescription | `RX-YYMMDD-XXXXX` | RX-260313-B2E4A |
| Patient | `PT-YYMMDD-XXXXX` | PT-260313-C1D9F |
| Wholesale Order | `WS-YYMMDD-XXXXX` | WS-260313-D4A8E |
| Purchase Order | `PO-YYMMDD-XXXXX` | PO-260313-E5B7C |
| Medication Refill | `MR-YYMMDD-XXXXX` | MR-260313-F6C2D |
| Invoice Number | `INV-YYYY-XXXXX` | INV-2026-00042 |
| SKU | `PF-[timestamp][random]` | PF-1710345600ABC |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

---

## Author

**Humphrey Abwao**  
GitHub: [@humphreyabwao](https://github.com/humphreyabwao)

---

## License

This project is proprietary software. All rights reserved.
