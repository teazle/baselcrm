# Basel Medical CRM & Claim Automation System
## Professional Development Specification & Invoice

---

## Executive Summary

This document outlines the comprehensive specification and development breakdown for the **Basel Medical CRM & Claim Automation System** - a sophisticated dual-platform solution combining a modern web-based Customer Relationship Management (CRM) system with an intelligent browser automation engine for insurance claim processing.

**System Components:**
1. **Next.js CRM Application** - Full-featured healthcare CRM with patient, case, and billing management
2. **Playwright Automation Engine** - Browser automation for multi-portal insurance claim processing
3. **Supabase Backend** - Scalable database, authentication, and real-time capabilities

---

## System Architecture

### 1. CRM Application (Next.js/React)

**Technology Stack:**
- **Framework:** Next.js 16.1.1 (App Router)
- **UI Library:** React 19.2.3
- **Styling:** Tailwind CSS 4.0
- **Forms:** React Hook Form 7.69.0 + Zod 4.2.1 validation
- **Backend:** Supabase (PostgreSQL + Auth + Realtime)
- **Language:** TypeScript 5.0

**Core Modules:**

#### 1.1 Authentication & Authorization
- Supabase-based authentication system
- Protected routes with RequireAuth component
- User session management
- Row-level security (RLS) policies for multi-tenant data isolation

#### 1.2 Contact Management
- Patient records with comprehensive demographics
- Contact types: Patient, SSOC Staff, Referral Source
- Fields include: Name, IC/Passport, DOB, contact info, next-of-kin, addresses, medical history
- Full CRUD operations with validation
- Data tables with sorting, filtering, pagination

#### 1.3 Company/Account Management
- Corporate account management
- Company codes and billing information
- Statement of account generation
- Billing address management
- Active/inactive status tracking

#### 1.4 Project Management
- Company program management
- Automation list configuration
- Project-linked case tracking
- Project metadata and configuration

#### 1.5 Case Management
- Parent record for visits and billing
- Case types: Billing, Dental, Dermatology, ENT, Eye, Orthopaedic, Non-orthopaedic, Urology
- Case classification by region and type
- Injury tracking (details, description, date)
- Billing configuration (Main Contractor, Direct Employer, Others, Self Payment)
- Special remarks and monitoring flags
- SMS trigger configuration

#### 1.6 Visit Management
- Clinical visit records
- Visit date and record numbering
- Linkage to cases and contacts
- Treatment line items
- Visit totals and outstanding amounts
- Visit treatment lists with cost tracking

#### 1.7 Treatment Master
- Master catalog of billable items
- Treatment codes and descriptions
- Pricing and unit configuration
- Used across visit line items

#### 1.8 Receipt Management
- Payment and credit note tracking
- Receipt numbering system
- Transaction types
- Receipt-to-visit offset tracking
- Balance and amount applied calculations
- Receipt offset reconciliation

#### 1.9 Task Management
- User-specific task tracking
- Task status and priority
- Due date management
- Task descriptions
- Per-user task isolation via RLS

#### 1.10 Reports & Export
- Statement of Account (by company)
- Receipt/Credit Note export
- Visit Invoice generation
- CSV export functionality
- Print-ready HTML templates with PDF generation
- Report filtering and selection

#### 1.11 User Interface Components
- Responsive layout with sidebar navigation
- Mobile-friendly header and navigation
- Quick Create FAB (Floating Action Button)
- Data tables with advanced filtering
- Form validation with error handling
- Lookup/autocomplete components
- Modern card-based UI design
- Shimmer effects and animations

### 2. Claim Automation Engine (Node.js/Playwright)

**Technology Stack:**
- **Runtime:** Node.js (ES Modules)
- **Automation:** Playwright 1.40.0
- **Logging:** Winston 3.11.0
- **Configuration:** dotenv 16.3.1

**Core Modules:**

#### 2.1 Browser Management
- Automated browser instance management
- Page isolation for multi-portal operations
- Screenshot capture for debugging
- Error recovery and retry logic
- Headless and headed mode support

#### 2.2 Portal Integration

**Clinic Assist Automation:**
- Automated login with credential management
- Queue navigation (Branch > Department > Queue)
- Patient extraction from queue
- Visit record access and data extraction
- Claim details extraction:
  - MC days
  - Diagnosis text
  - Treatment items
  - Charge types
  - Special remarks
  - Medicine names
- Patient NRIC extraction
- Visit type detection (New/Follow-up)
- Modal dismissal and error handling

**MHC Asia Automation:**
- Automated login with 2FA support
- Patient search by NRIC
- Portal detection (AIA, MHC, etc.)
- Normal Visit workflow automation
- AIA Program search navigation
- Card and patient selection
- Visit form automation:
  - Visit type/Charge type
  - MC days
  - Diagnosis selection (AI-powered best-effort matching)
  - Consultation fee maximization
  - Services/drugs entry
  - Special remarks processing
  - Diagnosis category and waiver
- Draft save functionality (safe mode - no submission)

#### 2.3 Claim Workflow Orchestration
- End-to-end workflow automation
- 21-step orchestrated process
- Step-by-step logging with progress tracking
- Error handling and recovery
- Data transformation between portals
- Environment-based configuration

#### 2.4 Utility Modules
- Comprehensive logging system (combined.log, error.log)
- Step-by-step workflow logging
- Screenshot management
- Configuration management
- Error tracking and reporting

---

## Database Schema

### Core Tables

1. **contacts** - Patient and stakeholder records
2. **accounts** - Company/account information
3. **projects** - Company programs and automation lists
4. **cases** - Parent records for visits and billing
5. **visits** - Clinical visit records
6. **visit_treatments** - Treatment line items
7. **treatment_master** - Master catalog of billable items
8. **receipts** - Payment and credit note records
9. **receipt_visit_offsets** - Payment-to-visit matching
10. **tasks** - User task management

### Security Features
- Row-Level Security (RLS) enabled
- Per-user data isolation
- Authentication via Supabase Auth
- Secure credential management (environment variables)

---

## Key Features

### CRM Features
✅ Multi-tenant architecture with user isolation
✅ Comprehensive patient/contact management
✅ Case-based visit tracking
✅ Billing and receipt management
✅ Treatment master catalog
✅ Report generation and export
✅ Responsive mobile-friendly UI
✅ Real-time data updates
✅ Form validation and error handling
✅ Quick create functionality
✅ Advanced data tables

### Automation Features
✅ Multi-portal browser automation
✅ Intelligent claim data extraction
✅ AI-powered diagnosis matching
✅ 2FA support
✅ Draft-only safe mode
✅ Comprehensive error logging
✅ Screenshot debugging
✅ Flexible configuration
✅ Retry logic and error recovery
✅ Step-by-step progress tracking

---

## Development Deliverables

### Phase 1: CRM Foundation
- Authentication system
- Database schema design and implementation
- Core UI components and layout
- Responsive navigation system

### Phase 2: Core CRM Modules
- Contact management (CRUD + tables)
- Company/Account management
- Project management
- Case management with full form
- Visit management with treatments
- Receipt management with offsets
- Treatment master catalog
- Task management

### Phase 3: Advanced Features
- Reports module with export functionality
- CSV generation
- Print templates (HTML to PDF)
- Quick Create FAB
- Data table enhancements
- Form validation and error handling

### Phase 4: Automation Engine
- Browser management infrastructure
- Clinic Assist automation module
- MHC Asia automation module
- Claim workflow orchestration
- Logging and debugging system
- Configuration management

### Phase 5: Integration & Testing
- End-to-end workflow testing
- Error handling refinement
- Performance optimization
- Documentation

---

## Technical Specifications

### Performance
- Optimized database queries with indexing
- Efficient data pagination
- Lazy loading where appropriate
- Optimized React rendering

### Security
- Row-Level Security (RLS) policies
- Secure credential storage
- Environment variable management
- HTTPS enforcement
- Input validation and sanitization

### Scalability
- Supabase scalable backend
- Efficient data structures
- Optimized queries
- Modular architecture for easy expansion

### Maintainability
- TypeScript for type safety
- Modular code structure
- Comprehensive logging
- Error handling
- Documentation

---

## System Integration Points

1. **Clinic Assist Portal** - Data extraction source
2. **MHC Asia Portal** - Claim submission destination
3. **Supabase** - Database, authentication, storage
4. **Environment Configuration** - Secure credential management

---

## Browser Compatibility

- Chrome/Chromium (via Playwright)
- Supports modern web standards
- Responsive design for mobile/tablet/desktop

---

## Deployment

### CRM Application
- Next.js production build
- Deployable to Vercel, AWS, or custom infrastructure
- Environment variable configuration required

### Automation Engine
- Node.js server/process
- Requires Playwright browser installation
- Environment variable configuration required
- Can run as scheduled job or API service

---

## Documentation

- README files
- Quick start guide
- Code documentation
- Configuration examples
- Troubleshooting guides

---

## Support & Maintenance

- Error logging and monitoring
- Screenshot-based debugging
- Comprehensive log files
- Modular architecture for easy updates

---

*This specification represents a production-ready, enterprise-grade system designed for healthcare administration and insurance claim automation.*

