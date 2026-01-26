# INVOICE
## Professional Software Development Services

---

**Invoice Number:** BASELMED-2025-001  
**Date:** January 2025  
**Project:** Basel Medical CRM & Claim Automation System  
**Client:** [Client Name]  
**Prepared By:** [Development Company Name]

---

## Project Overview

This invoice covers the complete development of a dual-platform healthcare CRM and insurance claim automation system. The system consists of a modern Next.js-based CRM application (Basel Medical CRM) for managing patients, cases, visits, and billing, combined with an intelligent browser automation engine for processing insurance claims across multiple portals.

---

## DEVELOPMENT BREAKDOWN

### 1. CRM APPLICATION DEVELOPMENT

#### 1.1 Foundation & Architecture (120 hours)
- Project setup and configuration (Next.js 16, TypeScript, Tailwind CSS)
- Authentication system with Supabase integration
- Database schema design and implementation
- Row-Level Security (RLS) policies
- Core UI component library development
- Responsive layout system (Sidebar, Header, Navigation)
- Routing architecture and protected routes
- Environment configuration management

**Rate:** $150/hour  
**Subtotal:** $18,000.00

#### 1.2 Contact Management Module (40 hours)
- Contact CRUD operations with validation
- Contact data model (Patient, SSOC Staff, Referral Source)
- Comprehensive form with 20+ fields
- Data table with sorting, filtering, pagination
- Contact detail pages
- Contact lookup/autocomplete components
- Integration with account/company records

**Rate:** $150/hour  
**Subtotal:** $6,000.00

#### 1.3 Company/Account Management Module (35 hours)
- Account CRUD operations
- Company code management
- Billing information management
- Statement of account data structure
- Account lookup and selection
- Account status management (active/inactive)

**Rate:** $150/hour  
**Subtotal:** $5,250.00

#### 1.4 Project Management Module (30 hours)
- Project CRUD operations
- Company program configuration
- Automation list management
- Project-case-visit linkage
- Project metadata management

**Rate:** $150/hour  
**Subtotal:** $4,500.00

#### 1.5 Case Management Module (50 hours)
- Complex case form with 15+ fields
- Case types (8 medical specialties)
- Injury tracking and classification
- Billing configuration options
- Special remarks system
- Case-visit relationship management
- Case detail pages with visit lists
- Monitoring and SMS trigger flags

**Rate:** $150/hour  
**Subtotal:** $7,500.00

#### 1.6 Visit Management Module (60 hours)
- Visit CRUD operations
- Visit record numbering system
- Treatment line item management
- Visit totals and outstanding calculations
- Visit detail pages with treatments
- Visit-case-contact linkage
- Visit date management with timezone handling
- Treatment cost calculations

**Rate:** $150/hour  
**Subtotal:** $9,000.00

#### 1.7 Treatment Master Module (25 hours)
- Treatment master catalog CRUD
- Treatment code management
- Pricing and unit configuration
- Treatment lookup/selection
- Integration with visit treatments

**Rate:** $150/hour  
**Subtotal:** $3,750.00

#### 1.8 Receipt Management Module (55 hours)
- Receipt CRUD operations
- Receipt numbering system
- Transaction type management
- Receipt-to-visit offset tracking
- Balance and amount applied calculations
- Offset reconciliation logic
- Receipt offset list management
- Payment and credit note handling

**Rate:** $150/hour  
**Subtotal:** $8,250.00

#### 1.9 Task Management Module (30 hours)
- Task CRUD with RLS policies
- User-specific task isolation
- Task status and priority management
- Due date tracking
- Task detail pages

**Rate:** $150/hour  
**Subtotal:** $4,500.00

#### 1.10 Reports & Export Module (45 hours)
- Statement of Account report generation
- Receipt/Credit Note export
- Visit Invoice generation
- CSV export functionality
- Print-ready HTML templates
- PDF generation capability
- Report filtering and data selection
- Company-based report generation

**Rate:** $150/hour  
**Subtotal:** $6,750.00

#### 1.11 Advanced UI Components & Enhancements (50 hours)
- Quick Create FAB component
- Advanced data tables with filtering
- Lookup/autocomplete components
- Form validation system (Zod schemas)
- Error handling and user feedback
- Loading states and animations
- Shimmer effects
- Mobile navigation improvements
- UI polish and refinements

**Rate:** $150/hour  
**Subtotal:** $7,500.00

---

### 2. BROWSER AUTOMATION ENGINE

#### 2.1 Browser Management Infrastructure (40 hours)
- Playwright browser instance management
- Page isolation and management system
- Screenshot capture system
- Error recovery and retry logic
- Configuration management
- Headless/headed mode support
- Browser lifecycle management

**Rate:** $175/hour  
**Subtotal:** $7,000.00

#### 2.2 Clinic Assist Automation Module (80 hours)
- Portal login automation
- Queue navigation system (Branch > Dept > Queue)
- Patient extraction from queue
- NRIC extraction logic
- Visit record access automation
- Claim data extraction:
  - MC days extraction
  - Diagnosis text extraction
  - Treatment items extraction
  - Charge type extraction
  - Special remarks extraction
  - Medicine names extraction
- Visit type detection (New/Follow-up)
- Modal dismissal logic
- Error handling and recovery
- Flexible selector strategies

**Rate:** $175/hour  
**Subtotal:** $14,000.00

#### 2.3 MHC Asia Automation Module (100 hours)
- Portal login with 2FA support
- Patient search by NRIC
- Portal detection logic (AIA, MHC, etc.)
- Normal Visit workflow automation
- AIA Program search navigation
- Card and patient selection
- Comprehensive form automation:
  - Visit type/Charge type
  - MC days (always 0)
  - Diagnosis selection (AI-powered matching)
  - Consultation fee maximization
  - Services/drugs entry
  - Special remarks processing
  - Diagnosis category and waiver
- Draft save functionality (safe mode)
- Error handling for portal variations

**Rate:** $175/hour  
**Subtotal:** $17,500.00

#### 2.4 Claim Workflow Orchestration (60 hours)
- End-to-end workflow design (21 steps)
- Workflow orchestration engine
- Data transformation between portals
- Step-by-step progress tracking
- Comprehensive logging system
- Error handling and recovery
- Environment-based configuration
- Workflow parameter management
- Result aggregation and reporting

**Rate:** $175/hour  
**Subtotal:** $10,500.00

#### 2.5 Logging & Debugging System (30 hours)
- Winston logging integration
- Step-by-step workflow logger
- Screenshot management system
- Error logging and tracking
- Combined and error log files
- Console output formatting
- Debug mode enhancements

**Rate:** $150/hour  
**Subtotal:** $4,500.00

#### 2.6 Testing & Integration (40 hours)
- End-to-end workflow testing
- Portal integration testing
- Error scenario testing
- Configuration testing
- Performance optimization
- Bug fixes and refinements

**Rate:** $150/hour  
**Subtotal:** $6,000.00

---

### 3. DATABASE & BACKEND

#### 3.1 Database Design & Implementation (45 hours)
- Complete database schema design
- Table creation scripts
- Index optimization
- Trigger functions (updated_at)
- Foreign key relationships
- Data type optimization
- Supabase integration

**Rate:** $150/hour  
**Subtotal:** $6,750.00

#### 3.2 Security & RLS Policies (25 hours)
- Row-Level Security policy design
- Per-user data isolation
- Security audit
- Policy implementation and testing
- Authentication integration

**Rate:** $150/hour  
**Subtotal:** $3,750.00

#### 3.3 Data Access Layer (35 hours)
- Supabase client integration
- CRUD operation wrappers
- Query optimization
- Error handling
- Type-safe data access
- Data coercion utilities

**Rate:** $150/hour  
**Subtotal:** $5,250.00

---

### 4. INTEGRATION & TESTING

#### 4.1 System Integration (40 hours)
- CRM-Automation integration points
- Data flow validation
- API integration testing
- End-to-end scenario testing

**Rate:** $150/hour  
**Subtotal:** $6,000.00

#### 4.2 Quality Assurance (50 hours)
- Functional testing
- UI/UX testing
- Browser compatibility testing
- Performance testing
- Security testing
- Bug fixes and refinements

**Rate:** $125/hour  
**Subtotal:** $6,250.00

---

### 5. DOCUMENTATION & DELIVERABLES

#### 5.1 Technical Documentation (30 hours)
- README documentation
- Quick start guides
- API documentation
- Configuration guides
- Architecture documentation
- Deployment guides

**Rate:** $125/hour  
**Subtotal:** $3,750.00

#### 5.2 User Documentation (20 hours)
- User guides
- Feature documentation
- Troubleshooting guides
- FAQ documentation

**Rate:** $100/hour  
**Subtotal:** $2,000.00

---

## SUMMARY

| Category | Hours | Rate | Amount |
|----------|-------|------|--------|
| CRM Application Development | 540 | $150/hr | $81,000.00 |
| Browser Automation Engine | 350 | $175/hr | $59,500.00 |
| Automation Logging & Testing | 70 | $150/hr | $10,500.00 |
| Database & Backend | 105 | $150/hr | $15,750.00 |
| Integration & Testing | 90 | $137.50/hr (avg) | $12,250.00 |
| Documentation | 50 | $112.50/hr (avg) | $5,750.00 |
| **TOTAL** | **1,205** | | **$184,750.00** |

---

## PAYMENT TERMS

**Payment Schedule:**
- 30% upon project initiation: $55,425.00
- 40% upon completion of core modules: $73,900.00
- 30% upon final delivery and acceptance: $55,425.00

**Payment Terms:** Net 30 days

---

## DELIVERABLES

✅ Complete Next.js CRM application with all modules  
✅ Browser automation engine with multi-portal support  
✅ Database schema and implementation  
✅ Authentication and security system  
✅ Comprehensive documentation  
✅ Source code and repository access  
✅ Deployment configurations  
✅ Testing suite and test results  

---

## ADDITIONAL SERVICES (OPTIONAL)

- **Extended Support & Maintenance:** $150/hour
- **Additional Portal Integration:** $15,000 - $25,000 per portal
- **Custom Feature Development:** $150/hour
- **Performance Optimization:** $150/hour
- **Security Audit:** $5,000 - $10,000

---

## NOTES

1. All rates are in USD
2. Development time includes design, implementation, testing, and documentation
3. All source code and intellectual property rights transfer to client upon final payment
4. System built with modern, scalable technologies for long-term maintainability
5. Includes comprehensive error handling, logging, and debugging capabilities
6. System designed for production deployment with security best practices

---

## CONTACT

For questions regarding this invoice, please contact:

**[Development Company Name]**  
**Email:** [email@company.com]  
**Phone:** [phone number]

---

**Thank you for your business!**

---

*This invoice represents professional software development services delivered to enterprise-grade standards with comprehensive documentation, testing, and support.*

