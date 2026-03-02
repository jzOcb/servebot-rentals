-- ServeBot Rentals - security and booking RPC functions
-- Run after schema.sql in Supabase SQL editor

CREATE OR REPLACE FUNCTION public.create_pending_booking_atomic(
    p_booking_id UUID,
    p_customer_name TEXT,
    p_customer_email TEXT,
    p_customer_phone TEXT,
    p_rental_type TEXT,
    p_start_date DATE,
    p_end_date DATE,
    p_pickup_delivery TEXT,
    p_delivery_address TEXT,
    p_total_amount INTEGER,
    p_deposit_amount INTEGER,
    p_notes TEXT,
    p_stripe_session_id TEXT
)
RETURNS TABLE (booking_id UUID, machine_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_machine_id UUID;
BEGIN
    IF p_booking_id IS NULL THEN
        RAISE EXCEPTION 'booking id is required';
    END IF;

    SELECT m.id
    INTO v_machine_id
    FROM machines m
    WHERE m.status = 'active'
      AND NOT EXISTS (
          SELECT 1
          FROM bookings b
          WHERE b.machine_id = m.id
            AND daterange(b.start_date, b.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
            AND (
                b.status IN ('confirmed', 'in_progress')
                OR (b.status = 'pending' AND b.created_at >= NOW() - INTERVAL '30 minutes')
            )
      )
      AND NOT EXISTS (
          SELECT 1
          FROM blocked_dates bd
          WHERE bd.date BETWEEN p_start_date AND p_end_date
            AND (bd.machine_id IS NULL OR bd.machine_id = m.id)
      )
    ORDER BY m.created_at, m.id
    LIMIT 1
    FOR UPDATE OF m SKIP LOCKED;

    IF v_machine_id IS NULL THEN
        RAISE EXCEPTION 'no_available_machine';
    END IF;

    INSERT INTO bookings (
        id,
        machine_id,
        customer_name,
        customer_email,
        customer_phone,
        rental_type,
        start_date,
        end_date,
        pickup_delivery,
        delivery_address,
        total_amount,
        deposit_amount,
        status,
        stripe_session_id,
        notes
    ) VALUES (
        p_booking_id,
        v_machine_id,
        p_customer_name,
        p_customer_email,
        p_customer_phone,
        p_rental_type,
        p_start_date,
        p_end_date,
        p_pickup_delivery,
        p_delivery_address,
        p_total_amount,
        p_deposit_amount,
        'pending',
        p_stripe_session_id,
        p_notes
    )
    RETURNING id, bookings.machine_id INTO booking_id, machine_id;

    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_booking_ranges_for_availability(
    p_start_date DATE,
    p_end_date DATE,
    p_pending_cutoff TIMESTAMPTZ
)
RETURNS TABLE (
    start_date DATE,
    end_date DATE,
    machine_id UUID,
    status TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT b.start_date, b.end_date, b.machine_id, b.status, b.created_at
    FROM bookings b
    WHERE b.machine_id IS NOT NULL
      AND b.start_date <= p_end_date
      AND b.end_date >= p_start_date
      AND (
          b.status IN ('confirmed', 'in_progress')
          OR (b.status = 'pending' AND b.created_at >= p_pending_cutoff)
      );
$$;

CREATE OR REPLACE FUNCTION public.get_public_booking_status(
    p_booking_id UUID DEFAULT NULL,
    p_session_id TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    status TEXT,
    rental_type TEXT,
    start_date DATE,
    end_date DATE,
    pickup_delivery TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT b.id, b.status, b.rental_type, b.start_date, b.end_date, b.pickup_delivery
    FROM bookings b
    WHERE (p_booking_id IS NOT NULL AND b.id = p_booking_id)
       OR (p_session_id IS NOT NULL AND b.stripe_session_id = p_session_id)
    ORDER BY b.created_at DESC
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.create_pending_booking_atomic(UUID, TEXT, TEXT, TEXT, TEXT, DATE, DATE, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_booking_ranges_for_availability(DATE, DATE, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_booking_status(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_pending_booking_atomic(UUID, TEXT, TEXT, TEXT, TEXT, DATE, DATE, TEXT, TEXT, INTEGER, INTEGER, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_ranges_for_availability(DATE, DATE, TIMESTAMPTZ) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_booking_status(UUID, TEXT) TO anon, authenticated, service_role;
