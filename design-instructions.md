# T-intelligence - Design Instructions

## Overview
This document contains all design specifications, styling guidelines, and instructions for maintaining consistency across the T-intelligence application. The design follows a tech-focused, data-dense aesthetic similar to FX/trading platforms, optimized for institutional use.

---

## Design Philosophy

### Core Principles
- **Tech-Focused**: Professional, technical aesthetic inspired by financial trading platforms
- **Data-Dense**: Maximize information density while maintaining readability
- **Compact Layout**: Efficient use of space with tight spacing
- **Data Visualization First**: Emphasis on charts, graphs, and metrics
- **Modern & Fluid**: Responsive design with smooth transitions
- **Institutional Grade**: Professional appearance suitable for government/enterprise use

---

## Color Palette

### Primary Colors
- **Navy Blue (Primary)**: `#1E3A8A` - Main brand color
  - Used for: Primary actions, accents, active states, branding
  - Dark variant: `#1E40AF`
  - Light variant: `#3B82F6`

### Background Colors
- **Light Background**: `#F9FAFB` (`bg-gray-50`) - Main content areas
- **Medium Background**: `#F3F4F6` (`bg-gray-100`) - Page background
- **White**: `#FFFFFF` - Cards, panels, forms
- **Dark Sidebar**: `#111827` (`bg-gray-900`) - Navigation sidebar
- **Sidebar Borders**: `#1F2937` (`border-gray-800`)

### Text Colors
- **Primary Text**: `#111827` (`text-gray-900`)
- **Secondary Text**: `#6B7280` (`text-gray-600`)
- **Tertiary Text**: `#9CA3AF` (`text-gray-500`)
- **Light Text (Dark BG)**: `#D1D5DB` (`text-gray-300`)
- **White Text**: `#FFFFFF` (`text-white`)

### Status Colors
- **Success/Positive**: `#059669` (`text-green-600`) - Green
- **Warning**: `#D97706` (`text-yellow-800`) - Yellow/Amber
- **Error/High Risk**: `#DC2626` (`text-red-600`) - Red
- **Info**: `#2563EB` (`text-blue-600`) - Blue
- **Medium Risk**: `#EA580C` (`text-orange-600`) - Orange

---

## Typography

### Font Families
- **Primary Font**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`
  - Used for: All UI text, labels, content
- **Monospace Font (Metrics)**: `'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace`
  - Used for: Numbers, metrics, timestamps, data values
  - Apply via class: `.metric-value`

### Font Sizes
- **Large Headings**: `text-2xl` / `text-3xl` (24px / 30px)
- **Medium Headings**: `text-lg` / `text-xl` (18px / 20px)
- **Small Headings**: `text-sm` (14px)
- **Body Text**: `text-sm` (14px)
- **Small Text**: `text-xs` (12px)
- **Metrics/Large Numbers**: `text-2xl` / `text-3xl` with monospace font

### Font Weights
- **Bold**: `font-bold` (700) - Headings, important metrics
- **Semibold**: `font-semibold` (600) - Section headers
- **Medium**: `font-medium` (500) - Labels, emphasized text
- **Regular**: Default (400) - Body text

---

## Spacing System

### Compact Spacing (Primary Pattern)
- **Tiny**: `0.5` (2px) - `space-y-0.5`, `gap-0.5`
- **Small**: `1` (4px) - `p-1`, `gap-1`
- **Base**: `2` (8px) - `p-2`, `gap-2`, `space-y-2`
- **Medium**: `3` (12px) - `p-3`, `gap-3`, `space-y-3`
- **Large**: `4` (16px) - `p-4`, `gap-4`
- **Extra Large**: `6` (24px) - `p-6`, `mb-6`, `space-y-6`

### Component-Specific Spacing
- **Card Padding**: `p-3` (12px) - Compact cards
- **Card Padding (Large)**: `p-6` (24px) - Larger cards
- **Table Cell Padding**: `px-3 py-2` (12px horizontal, 8px vertical)
- **Form Input Padding**: `px-4 py-2.5` (16px horizontal, 10px vertical)
- **Button Padding**: `px-4 py-2.5` (16px horizontal, 10px vertical)

---

## Component Styles

### Sidebar (Navigation)
- **Background**: Dark (`bg-gray-900`)
- **Width**: `w-56` (224px)
- **Border**: Right border `border-gray-800`
- **Link Hover**: `rgba(255, 255, 255, 0.05)`
- **Active Link**:
  - Background: `rgba(30, 58, 138, 0.2)`
  - Border-left: `3px solid #1E3A8A`
  - Text color: `#60A5FA` (light blue)
- **Link Text**: `text-gray-300`
- **Icon Size**: `w-4 h-4`
- **Link Padding**: `px-3 py-2`

### Cards
- **Background**: White (`bg-white`)
- **Border**: `border border-gray-200`
- **Border Radius**: `rounded` or `rounded-lg`
- **Padding**: `p-3` (compact) or `p-6` (larger)
- **Shadow**: Minimal or none (borders preferred)

### Tables
- **Header Background**: `bg-gray-50`
- **Header Text**: `text-gray-500`, `uppercase`, `tracking-wider`, `text-xs`
- **Cell Padding**: `px-3 py-2`
- **Row Hover**: `bg-gray-50` or `bg-gray-100`
- **Divider**: `divide-y divide-gray-200`
- **Text Size**: `text-xs` for compact tables

### Forms
- **Input Border**: `border border-gray-300`
- **Input Focus**: `focus:ring-2 focus:ring-blue-900 focus:border-blue-900`
- **Label Style**: `text-xs`, `font-medium`, `uppercase`, `tracking-wide`
- **Button Primary**: `bg-gray-900 hover:bg-gray-800` (dark button)
- **Button Text**: White with `text-sm font-medium`

### Metric Cards
- **Structure**:
  - Label: `text-xs`, `uppercase`, `tracking-wide`, `text-gray-500`
  - Value: Large monospace font (`metric-value`, `text-2xl` or `text-3xl`, `font-bold`)
  - Trend/Change: Small text with color coding (`text-xs`, `font-medium`)
- **Sparkline**: Inline SVG mini-charts with `sparkline` class
- **Icon**: Optional background icon with low opacity (`opacity-20`)

---

## Data Visualization

### Sparklines
- **Class**: `.sparkline`
- **Style**: `stroke: currentColor`, `fill: none`, `stroke-width: 1.5`
- **Size**: Typically `w-16 h-6` (64px × 24px)
- **Usage**: Inline mini-trend charts within metric cards

### Area Charts
- **Background Gradient**: Linear gradient from primary blue with opacity to transparent
- **Line Style**: `stroke-width: 2`, navy blue color
- **Grid Lines**: Light gray (`#E5E7EB`) with class `.grid-line`
- **ViewBox**: Responsive with `preserveAspectRatio="none"`

### Color Coding
- **Positive/Up**: Green (`text-green-600`)
- **Negative/Down**: Red (`text-red-600`)
- **Neutral/Info**: Blue (`text-blue-600`)
- **Warning**: Yellow/Orange (`text-yellow-800` / `text-orange-600`)

### Badges/Tags
- **Severity High**: `bg-red-100 text-red-800` with uppercase text ("HIGH")
- **Severity Medium**: `bg-yellow-100 text-yellow-800` or `bg-orange-100 text-orange-800` ("MED")
- **Severity Low**: `bg-blue-100 text-blue-800` ("LOW")
- **Padding**: `px-1.5 py-0.5`
- **Text**: `text-xs font-medium rounded`

---

## Layout Patterns

### Dashboard Layout
- **Sidebar**: Fixed left sidebar (`fixed h-full`, `w-56`)
- **Main Content**: Flex column with `ml-56` margin to account for sidebar
- **Header**: Compact header with `px-4 py-2`
- **Content Area**: `p-3` padding with `space-y-3` vertical spacing
- **Grid**: Responsive grids using `grid-cols-2 lg:grid-cols-4 xl:grid-cols-6` for metrics

### Login Page Layout
- **Background**: Gradient from primary navy blue (`#1E3A8A` to `#1E40AF`)
- **Card**: Centered, max-width `max-w-md`
- **Card Background**: White with subtle shadow
- **Centering**: `flex items-center justify-center` on body

---

## Interactive States

### Hover States
- **Links**: Subtle background color change (use rgba for transparency on dark backgrounds)
- **Table Rows**: `hover:bg-gray-50` or `hover:bg-gray-100`
- **Buttons**: Darker shade on hover (`hover:bg-gray-800`)

### Focus States
- **Inputs**: `focus:ring-2 focus:ring-blue-900 focus:border-blue-900`
- **Buttons**: `focus:ring-2 focus:ring-offset-2 focus:ring-gray-900`

### Active States
- **Navigation**: Active link uses distinct background and left border
- **Buttons**: Use darker shade or maintain base color (no active state if same as hover)

---

## Responsive Breakpoints

### Tailwind Default Breakpoints
- **sm**: `640px` - Small devices
- **md**: `768px` - Medium devices
- **lg**: `1024px` - Large devices
- **xl**: `1280px` - Extra large devices
- **2xl**: `1536px` - 2X extra large devices

### Common Responsive Patterns
- **Metric Grid**: `grid-cols-2 lg:grid-cols-4 xl:grid-cols-6`
- **Content Grid**: `grid-cols-1 lg:grid-cols-3`
- **Sidebar**: Fixed on desktop, should collapse/hide on mobile (future enhancement)

---

## CSS Custom Classes

### Metric Value
```css
.metric-value {
    font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
}
```
Use for: All numeric values, timestamps, percentages, counts

### Sparkline
```css
.sparkline {
    stroke: currentColor;
    fill: none;
    stroke-width: 1.5;
}
```
Use for: Inline trend line charts

### Grid Line
```css
.grid-line {
    stroke: #E5E7EB;
    stroke-width: 1;
}
```
Use for: Chart background grid lines

### Table Row Hover
```css
.table-row:hover {
    background-color: #F9FAFB;
}
```
Use for: Table row hover states

### Sidebar Link States
```css
.sidebar-link:hover {
    background-color: rgba(255, 255, 255, 0.05);
}
.sidebar-link.active {
    background-color: rgba(30, 58, 138, 0.2);
    border-left: 3px solid #1E3A8A;
    color: #60A5FA;
}
```

---

## Technical Requirements

### Dependencies
- **Tailwind CSS**: Via CDN (`https://cdn.tailwindcss.com`)
- **No JavaScript**: Static HTML only (no frameworks)
- **No External Libraries**: Pure HTML + Tailwind CSS

### Browser Support
- Modern browsers with CSS Grid and Flexbox support
- SVG support for charts and icons

### Accessibility
- Proper contrast ratios (WCAG AA minimum)
- Semantic HTML elements
- Form labels associated with inputs
- Focus states clearly visible
- ARIA attributes where needed (future enhancement)

---

## File Structure

```
T-intelligence/
├── login.html          # Login page
├── dashboard.html      # Main dashboard
└── design-instructions.md  # This file
```

---

## Design Consistency Checklist

When creating new pages or components, ensure:
- [ ] Uses primary navy blue (`#1E3A8A`) for primary actions
- [ ] Monospace font for all numeric values
- [ ] Compact spacing (p-3 for cards, gap-2 for grids)
- [ ] Dark sidebar (`bg-gray-900`) if navigation present
- [ ] Data visualization elements where appropriate
- [ ] Responsive grid layouts
- [ ] Proper focus states for accessibility
- [ ] Text sizes follow hierarchy (xs for labels, sm for body)
- [ ] Color-coded status indicators (green/red/yellow/orange)
- [ ] Consistent border radius (`rounded` for small, `rounded-lg` for larger)

---

## Future Enhancements

### Potential Additions
- Mobile-responsive sidebar (collapse/hamburger menu)
- Dark mode toggle
- Real-time data updates (WebSocket integration)
- Interactive charts (when JavaScript is added)
- Export functionality styling
- Advanced filtering UI components
- User profile/settings page styling

### Notes
- Keep design focused on data density and technical aesthetic
- Maintain navy blue as primary brand color
- Continue using monospace fonts for all metrics
- Preserve compact, efficient spacing patterns

---

## Quick Reference

### Most Used Colors
- Primary: `#1E3A8A` (Navy Blue)
- Background: `#F9FAFB` (Light Gray)
- Dark BG: `#111827` (Gray-900)
- Text: `#111827` (Gray-900)
- Border: `#E5E7EB` (Gray-200)

### Most Used Spacing
- Card padding: `p-3`
- Gap between items: `gap-2`
- Section spacing: `space-y-3`
- Table cell: `px-3 py-2`

### Most Used Typography
- Labels: `text-xs uppercase tracking-wide`
- Values: `metric-value text-2xl font-bold`
- Headings: `text-sm font-semibold`
- Body: `text-xs` or `text-sm`