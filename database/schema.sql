-- ServeBot Rentals Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Machines table
CREATE TABLE machines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'retired')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert initial machines
INSERT INTO machines (name, status) VALUES 
    ('Machine 1', 'active'),
    ('Machine 2', 'active'),
    ('Machine 3', 'active');

-- Bookings table
CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    machine_id UUID REFERENCES machines(id),
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    rental_type TEXT NOT NULL CHECK (rental_type IN (
        'half_day_weekday', 
        'full_day_weekday', 
        'half_day_weekend', 
        'full_day_weekend', 
        'weekend_package', 
        'weekly'
    )),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    pickup_delivery TEXT NOT NULL CHECK (pickup_delivery IN ('pickup', 'delivery')),
    delivery_address TEXT,
    total_amount INTEGER NOT NULL, -- in cents
    deposit_amount INTEGER NOT NULL DEFAULT 30000, -- $300 in cents
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',      -- awaiting payment
        'confirmed',    -- paid, scheduled
        'in_progress',  -- machine picked up
        'completed',    -- machine returned
        'cancelled'     -- cancelled/refunded
    )),
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Blocked dates table (for holidays, maintenance, etc.)
CREATE TABLE blocked_dates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    machine_id UUID REFERENCES machines(id), -- null = all machines
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(date, machine_id)
);

-- Indexes for performance
CREATE INDEX idx_bookings_dates ON bookings(start_date, end_date);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_blocked_dates_date ON blocked_dates(date);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for bookings updated_at
CREATE TRIGGER bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- RLS (Row Level Security) Policies
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_dates ENABLE ROW LEVEL SECURITY;

-- Public read access for machines
CREATE POLICY "Machines are viewable by everyone" 
    ON machines FOR SELECT 
    USING (true);

-- Public read access for bookings (for availability check)
CREATE POLICY "Bookings dates are viewable for availability" 
    ON bookings FOR SELECT 
    USING (true);

-- Public insert for new bookings
CREATE POLICY "Anyone can create bookings" 
    ON bookings FOR INSERT 
    WITH CHECK (true);

-- Service role can update bookings (for webhooks)
CREATE POLICY "Service role can update bookings" 
    ON bookings FOR UPDATE 
    USING (true);

-- Public read for blocked dates
CREATE POLICY "Blocked dates are viewable by everyone" 
    ON blocked_dates FOR SELECT 
    USING (true);

-- View for availability calculation
CREATE OR REPLACE VIEW daily_availability AS
SELECT 
    d.date,
    3 - COALESCE(booked.count, 0) - COALESCE(blocked.count, 0) AS available_machines,
    CASE 
        WHEN EXTRACT(DOW FROM d.date) IN (0, 6) THEN 'weekend'
        ELSE 'weekday'
    END AS day_type
FROM generate_series(
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '90 days',
    '1 day'
) AS d(date)
LEFT JOIN (
    SELECT 
        generate_series(start_date, end_date, '1 day')::date AS date,
        COUNT(*) AS count
    FROM bookings
    WHERE status IN ('pending', 'confirmed', 'in_progress')
    GROUP BY 1
) booked ON d.date = booked.date
LEFT JOIN (
    SELECT date, COUNT(*) AS count
    FROM blocked_dates
    WHERE machine_id IS NULL
    GROUP BY date
) blocked ON d.date = blocked.date;
