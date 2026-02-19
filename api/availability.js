// GET /api/availability
// Returns available dates for booking

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Pricing configuration
const PRICING = {
    half_day_weekday: { price: 4500, days: 1, dayType: 'weekday' },
    full_day_weekday: { price: 7500, days: 1, dayType: 'weekday' },
    half_day_weekend: { price: 5500, days: 1, dayType: 'weekend' },
    full_day_weekend: { price: 10000, days: 1, dayType: 'weekend' },
    weekend_package: { price: 17500, days: 2, dayType: 'weekend' },
    weekly: { price: 35000, days: 7, dayType: 'any' }
};

const TOTAL_MACHINES = 3;

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { start, end, type } = req.query;
        
        // Default to next 90 days if not specified
        const startDate = start || new Date().toISOString().split('T')[0];
        const endDate = end || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const rentalType = type || 'full_day_weekday';

        const config = PRICING[rentalType];
        if (!config) {
            return res.status(400).json({ error: 'Invalid rental type' });
        }

        // Get existing bookings in date range
        const { data: bookings, error: bookingsError } = await supabase
            .from('bookings')
            .select('start_date, end_date')
            .in('status', ['pending', 'confirmed', 'in_progress'])
            .lte('start_date', endDate)
            .gte('end_date', startDate);

        if (bookingsError) {
            console.error('Bookings error:', bookingsError);
            return res.status(500).json({ error: 'Database error' });
        }

        // Get blocked dates
        const { data: blockedDates, error: blockedError } = await supabase
            .from('blocked_dates')
            .select('date, machine_id')
            .gte('date', startDate)
            .lte('date', endDate);

        if (blockedError) {
            console.error('Blocked dates error:', blockedError);
            return res.status(500).json({ error: 'Database error' });
        }

        // Calculate availability for each date
        const availability = {};
        const current = new Date(startDate);
        const endDateObj = new Date(endDate);

        while (current <= endDateObj) {
            const dateStr = current.toISOString().split('T')[0];
            const dayOfWeek = current.getDay(); // 0=Sun, 6=Sat
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const isWeekday = !isWeekend;

            // Check if day type matches rental type
            let validDayType = false;
            if (config.dayType === 'any') {
                validDayType = true;
            } else if (config.dayType === 'weekend' && isWeekend) {
                validDayType = true;
            } else if (config.dayType === 'weekday' && isWeekday) {
                validDayType = true;
            }

            // For weekend_package, only show Saturdays
            if (rentalType === 'weekend_package' && dayOfWeek !== 6) {
                validDayType = false;
            }

            if (validDayType) {
                // Count booked machines for this date
                let bookedCount = 0;
                for (const booking of bookings || []) {
                    const bookingStart = new Date(booking.start_date);
                    const bookingEnd = new Date(booking.end_date);
                    if (current >= bookingStart && current <= bookingEnd) {
                        bookedCount++;
                    }
                }

                // Count blocked machines (null machine_id = all machines)
                let blockedCount = 0;
                for (const blocked of blockedDates || []) {
                    if (blocked.date === dateStr) {
                        if (blocked.machine_id === null) {
                            blockedCount = TOTAL_MACHINES; // All blocked
                        } else {
                            blockedCount++;
                        }
                    }
                }

                const availableMachines = Math.max(0, TOTAL_MACHINES - bookedCount - blockedCount);
                
                // For multi-day rentals (weekly), check consecutive availability
                let isAvailable = availableMachines > 0;
                
                if (rentalType === 'weekly' && isAvailable) {
                    // Check if 7 consecutive days are available
                    isAvailable = checkConsecutiveAvailability(
                        current, 
                        7, 
                        bookings || [], 
                        blockedDates || []
                    );
                }
                
                if (rentalType === 'weekend_package' && isAvailable) {
                    // Check if Sat+Sun are both available
                    const sunday = new Date(current);
                    sunday.setDate(sunday.getDate() + 1);
                    isAvailable = checkConsecutiveAvailability(
                        current, 
                        2, 
                        bookings || [], 
                        blockedDates || []
                    );
                }

                if (isAvailable) {
                    availability[dateStr] = availableMachines;
                }
            }

            current.setDate(current.getDate() + 1);
        }

        return res.status(200).json({
            rental_type: rentalType,
            price: config.price,
            days: config.days,
            available_dates: Object.keys(availability),
            machines_by_date: availability
        });

    } catch (error) {
        console.error('Availability error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

function checkConsecutiveAvailability(startDate, days, bookings, blockedDates) {
    const current = new Date(startDate);
    
    for (let i = 0; i < days; i++) {
        const dateStr = current.toISOString().split('T')[0];
        
        // Count booked
        let bookedCount = 0;
        for (const booking of bookings) {
            const bookingStart = new Date(booking.start_date);
            const bookingEnd = new Date(booking.end_date);
            if (current >= bookingStart && current <= bookingEnd) {
                bookedCount++;
            }
        }
        
        // Count blocked
        let blockedCount = 0;
        for (const blocked of blockedDates) {
            if (blocked.date === dateStr) {
                if (blocked.machine_id === null) {
                    return false; // All machines blocked
                }
                blockedCount++;
            }
        }
        
        if (TOTAL_MACHINES - bookedCount - blockedCount <= 0) {
            return false;
        }
        
        current.setDate(current.getDate() + 1);
    }
    
    return true;
}
