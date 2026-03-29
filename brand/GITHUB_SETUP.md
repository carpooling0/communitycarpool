# GitHub Pages Setup Guide

## Quick Start for Community Carpool Brand Guidelines

This guide walks you through setting up the brand guidelines on GitHub Pages and integrating it into your Support, Admin, and Super-Admin panels.

---

## Step 1: Create the GitHub Repository

### 1.1 Create a new repository

1. Go to https://github.com/new
2. Repository name: `brand`
3. Description: `Community Carpool Brand Guidelines`
4. Choose **Public** (for public access)
5. Click "Create repository"

### 1.2 Initialize the repository

```bash
cd /path/to/brand-guidelines
git init
git add .
git commit -m "Initial commit: Brand guidelines site"
git branch -M main
git remote add origin https://github.com/communitycarpool/brand.git
git push -u origin main
```

---

## Step 2: Enable GitHub Pages

1. Go to repository Settings
2. Scroll to "Pages" section
3. Under "Source", select:
   - Branch: **main**
   - Folder: **/ (root)**
4. Click "Save"

**Your site will be live at:** `https://communitycarpool.github.io/brand/`

---

## Step 3: Verify the Site

After 1-2 minutes, visit:
- https://communitycarpool.github.io/brand/ (should show the brand home page)
- https://communitycarpool.github.io/brand/pages/all-pages.html (should show all guidelines)

---

## Step 4: Integrate into Your Platforms

### 4.1 Link from Support Panel

In your Support panel (support.html or support component):

```html
<a href="https://communitycarpool.github.io/brand/" target="_blank">
  View Brand Guidelines
</a>
```

### 4.2 Link from Admin Panel

In your Admin dashboard component:

```javascript
const brandLink = "https://communitycarpool.github.io/brand/";

// Add to admin navigation
<a href={brandLink} target="_blank">Brand Guidelines</a>
```

### 4.3 Link from Super-Admin Panel

In your Super-Admin panel:

```html
<!-- Brand Resources Section -->
<div class="admin-section">
  <h3>Brand Resources</h3>
  <ul>
    <li><a href="https://communitycarpool.github.io/brand/" target="_blank">Brand Guidelines</a></li>
    <li><a href="https://communitycarpool.github.io/brand/pages/components.html" target="_blank">Design Components</a></li>
    <li><a href="https://communitycarpool.github.io/brand/pages/assets.html" target="_blank">Download Assets</a></li>
  </ul>
</div>
```

---

## Step 5: Update Content

### To add or modify pages:

1. Edit the HTML file in `pages/` directory
2. Commit changes:
   ```bash
   git add .
   git commit -m "Update: [Description of changes]"
   git push
   ```
3. Site updates automatically (may take 30 seconds to 1 minute)

### To add a new page:

1. Copy `pages/template.html` to `pages/new-page-name.html`
2. Update the content
3. Add link to `pages/all-pages.html`
4. Commit and push

---

## File Structure

```
brand/
├── index.html                 # Main brand home
├── README.md                  # Repository readme
├── _config.yml               # GitHub Pages config
├── .nojekyll                 # Skip Jekyll processing
└── pages/
    ├── all-pages.html        # All guidelines directory
    ├── foundation.html       # Brand foundation
    ├── voice.html            # Voice & tone
    ├── visual.html           # Visual identity
    ├── components.html       # Design components
    ├── assets.html           # Assets download
    ├── photography.html      # Photography guide
    ├── applications.html     # Real-world examples
    └── template.html         # Page template
```

---

## Custom Domain (Optional)

If you want to use a custom domain like `brand.communitycarpool.org`:

1. Create a `CNAME` file in the root with:
   ```
   brand.communitycarpool.org
   ```

2. Update your domain DNS:
   - Add CNAME record pointing to `communitycarpool.github.io`

3. Go to Repository Settings > Pages
4. Enter your custom domain
5. Click "Save"

---

## Access Control

### Public Access
- Brand site is publicly accessible
- Anyone can view guidelines
- Good for external partners, designers, developers

### Internal Access
- Add links from internal panels (Support, Admin, Super-Admin)
- Team members get direct access
- Can bookmark for quick reference

### Restricted Access (Optional)
If you want to restrict access:
- Make repository private
- Add team members in Settings > Collaborators
- Share link directly with internal team

---

## Maintenance

### Regular Updates
1. Update guidelines quarterly or as needed
2. Keep brand colors, fonts, components current
3. Add new pages as design system evolves

### Monitoring
- GitHub Pages automatically builds and deploys
- Check deployment status in Settings > Pages > "Deployments"
- View build logs if issues occur

### Backups
- GitHub automatically maintains version history
- All commits are saved
- Can revert to previous versions if needed

---

## Troubleshooting

### Site not showing up?
1. Wait 2-3 minutes after enabling Pages
2. Check that branch is set to `main` in Settings > Pages
3. Verify `.nojekyll` file exists in root

### Links broken?
1. Check file paths are correct
2. Ensure all referenced files exist
3. Use relative paths: `pages/file.html`

### Styling not working?
1. Clear browser cache (Ctrl+Shift+Delete)
2. Check CSS is in `<style>` tags or `<link>` tags
3. Verify no CSS file references external CDNs if offline

---

## Questions?

For setup help:
- Check GitHub Pages documentation: https://docs.github.com/en/pages
- Review repository README: See README.md in this folder

---

**Last Updated:** March 2026
