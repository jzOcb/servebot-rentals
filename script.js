// ServeBot Rentals - JavaScript

document.addEventListener('DOMContentLoaded', function() {
    
    // Pricing Toggle (Weekday/Weekend)
    const toggleBtns = document.querySelectorAll('.toggle-btn');
    const weekdayPrices = document.querySelectorAll('.weekday-price');
    const weekendPrices = document.querySelectorAll('.weekend-price');
    
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            // Update active state
            toggleBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // Toggle prices
            const period = this.dataset.period;
            if (period === 'weekend') {
                weekdayPrices.forEach(p => p.style.display = 'none');
                weekendPrices.forEach(p => p.style.display = 'inline');
            } else {
                weekdayPrices.forEach(p => p.style.display = 'inline');
                weekendPrices.forEach(p => p.style.display = 'none');
            }
        });
    });
    
    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                const navHeight = document.querySelector('.navbar').offsetHeight;
                const targetPosition = target.offsetTop - navHeight - 20;
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
    
    // Navbar background on scroll
    const navbar = document.querySelector('.navbar');
    window.addEventListener('scroll', function() {
        if (window.scrollY > 50) {
            navbar.style.background = 'rgba(26, 26, 26, 0.98)';
        } else {
            navbar.style.background = 'rgba(26, 26, 26, 0.95)';
        }
    });
    
    // Mobile menu toggle
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const navLinks = document.querySelector('.nav-links');
    
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', function() {
            navLinks.classList.toggle('active');
            this.classList.toggle('active');
        });
    }
    
    // Animation on scroll (simple fade in)
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);
    
    // Observe elements for animation
    document.querySelectorAll('.pricing-card, .step, .testimonial, .faq-item').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
    
});

// Cal.com integration helper (to be configured)
function initCalEmbed(calLink) {
    const bookingEmbed = document.querySelector('.booking-embed');
    if (bookingEmbed && calLink) {
        bookingEmbed.innerHTML = `
            <iframe 
                src="https://cal.com/${calLink}?embed=true&theme=dark" 
                width="100%" 
                height="600" 
                frameborder="0"
                style="border-radius: 12px;"
            ></iframe>
        `;
    }
}

// Uncomment and add your Cal.com link when ready:
// initCalEmbed('your-username/rental');
