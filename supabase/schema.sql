-- BUDDY AP Control System - Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Departments
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Seed departments
INSERT INTO departments (name) VALUES
  ('Fleet'), ('Safety'), ('Operations'), ('Finance')
ON CONFLICT DO NOTHING;

-- Users (extends Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text,
  role text DEFAULT 'viewer' CHECK (role IN ('admin','department_head','viewer')),
  department_id uuid REFERENCES departments(id),
  created_at timestamptz DEFAULT now()
);

-- Vendors
CREATE TABLE IF NOT EXISTS vendors (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  category text DEFAULT 'Other',
  frequency text DEFAULT 'Monthly',
  payment_method text DEFAULT 'ACH',
  department_id uuid REFERENCES departments(id),
  expected_amount numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number text,
  vendor_id uuid REFERENCES vendors(id),
  amount numeric NOT NULL DEFAULT 0,
  received_date date,
  due_date date,
  status text DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Disputed','Paid')),
  department_id uuid REFERENCES departments(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  notes text,
  source text DEFAULT 'manual',
  created_at timestamptz DEFAULT now()
);

-- Transactions
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_date date NOT NULL,
  vendor_id uuid REFERENCES vendors(id),
  vendor_name_raw text,
  amount numeric NOT NULL DEFAULT 0,
  payment_method text DEFAULT 'ACH',
  department_id uuid REFERENCES departments(id),
  matched_invoice_id uuid REFERENCES invoices(id),
  status text DEFAULT 'Unmatched' CHECK (status IN ('Matched','Unmatched','Disputed')),
  notes text,
  source text DEFAULT 'manual',
  created_at timestamptz DEFAULT now()
);

-- Approvals log
CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  action text CHECK (action IN ('Approved','Disputed')),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Row Level Security
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;

-- Policies: allow authenticated users to read everything
CREATE POLICY "Authenticated users can read departments" ON departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read users" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read vendors" ON vendors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read invoices" ON invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read transactions" ON transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read approvals" ON approvals FOR SELECT TO authenticated USING (true);

-- Policies: allow authenticated users to write
CREATE POLICY "Authenticated users can insert vendors" ON vendors FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update vendors" ON vendors FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert invoices" ON invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update invoices" ON invoices FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert transactions" ON transactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update transactions" ON transactions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert approvals" ON approvals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can insert users" ON users FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update users" ON users FOR UPDATE TO authenticated USING (true);

-- Function: auto-create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'role', 'viewer')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: fire on new auth user
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
