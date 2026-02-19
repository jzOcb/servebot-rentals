# ServeBot Rentals Website

Tennis ball machine rental website for Greater Boston area.

## Files

- `index.html` - English homepage
- `cn.html` - Chinese homepage
- `styles.css` - All styles
- `script.js` - JavaScript interactions

## Deployment Instructions

### Step 1: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `servebot-rentals`
3. Keep it Public
4. Click "Create repository"

### Step 2: Upload Files

1. Click "uploading an existing file"
2. Drag all files from this folder
3. Click "Commit changes"

### Step 3: Deploy to Vercel

1. Go to https://vercel.com
2. Click "Add New" → "Project"
3. Import your `servebot-rentals` repo
4. Click "Deploy"
5. Wait ~1 minute
6. Your site is live at `servebot-rentals.vercel.app`!

### Step 4: Add Custom Domain (Optional)

1. Buy domain at namecheap.com (e.g., servebotrentals.com)
2. In Vercel: Settings → Domains → Add
3. Follow DNS instructions

## Configuration

### Cal.com Booking Integration

1. Create events in Cal.com:
   - Half Day Rental - Weekday ($45)
   - Full Day Rental - Weekday ($70)
   - Half Day Rental - Weekend ($55)
   - Full Day Rental - Weekend ($100)
   - Weekend Package ($175)
   - Weekly Rental ($350)

2. Get your Cal.com link (e.g., `your-username/rental`)

3. In `script.js`, uncomment and update:
   ```javascript
   initCalEmbed('your-username/rental');
   ```

### Stripe Integration

For the $300 deposit, set up Stripe Checkout with authorization hold.
This requires backend code - contact for setup assistance.

### Images

Replace the placeholder image URL in both HTML files:
```html
<img src="YOUR_IMAGE_URL" alt="Tennis Ball Machine">
```

Recommended: Upload your own machine photos to the repo or use a CDN.

## Customization

### Colors
Edit `styles.css` variables:
```css
:root {
    --primary: #4CAF50;      /* Tennis green */
    --dark: #1a1a1a;         /* Background */
}
```

### Contact Email
Update in both HTML files:
```html
<a href="mailto:YOUR_EMAIL">📧 YOUR_EMAIL</a>
```

## Support

Questions? Contact your developer.
