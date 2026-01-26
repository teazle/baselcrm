export type UUID = string;

export type ContactRecordType = "Patient" | "SSOC Staff" | "Referral Source";

export type Contact = {
  id: UUID;
  user_id: UUID;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  mobile: string | null;
  record_type: ContactRecordType | null;
  account_id: UUID | null;
  registration_no: string | null;
  registration_date: string | null;
  ic_passport_no: string | null;
  nationality: string | null;
  sex: "Male" | "Female" | null;
  date_of_birth: string | null;
  age: number | null;
  marital_status: string | null;
  language: string | null;
  race: string | null;
  home_phone: string | null;
  other_phone: string | null;
  next_of_kin: string | null;
  relationship: string | null;
  contact_no_next_of_kin: string | null;
  special_remarks_contact: string | null;
  mailing_address: string | null;
  other_address: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactInsert = Partial<
  Omit<Contact, "id" | "created_at" | "updated_at">
>;

export type Account = {
  id: UUID;
  user_id: UUID;
  name: string;
  company_code: string | null;
  phone: string | null;
  email_statement_of_account: string | null;
  billing_street: string | null;
  active: boolean | null;
  created_at: string;
  updated_at: string;
};

export type AccountInsert = Partial<Omit<Account, "id" | "created_at" | "updated_at">>;


