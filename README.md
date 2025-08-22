# Welib Book Scraper

Automated book scraper for welib.org that downloads books with human-like behavior and duplicate detection.

## Features

- **Smart Duplicate Detection** - Never downloads the same book twice
- **Human-like Behavior** - Random delays, mouse movements, realistic interactions
- **Multiple Server Support** - Tries Server #2 first, falls back to Server #1
- **Automatic macOS Dialog Handling** - Handles download confirmation automatically
- **Book Variety** - Scrolls and selects different books each run
- **Scheduled Downloads** - Run automatically at set intervals
- **Comprehensive Logging** - Detailed logs of all activities

## Installation

1. Install dependencies:
```bash
npm install
```

## Quick Start

```bash
# Install dependencies (if not already done)
npm install

# Download books now
npm start

# Schedule regular downloads
npm run schedule
```

## How It Works

1. **Loads History** - Checks previously downloaded books
2. **Navigates Site** - Goes to welib.org with anti-detection measures
3. **Finds New Books** - Scrolls and discovers books not yet downloaded
4. **Smart Selection** - Picks books you don't already have
5. **Downloads Intelligently** - Uses fastest server, handles countdown timers
6. **Saves Progress** - Updates download history for future runs

## Configuration

### Cron Pattern Examples

- `"0 */6 * * *"` - Every 6 hours (default)
- `"0 */12 * * *"` - Every 12 hours  
- `"0 0 * * *"` - Daily at midnight
- `"0 8,20 * * *"` - Daily at 8 AM and 8 PM
- `"0 0 * * 1"` - Weekly on Monday at midnight

## File Structure

```
├── src/
│   ├── welib-scraper.js    # Main scraper with all features
│   └── scheduler.js        # Automated scheduling
├── downloads/              # Downloaded books storage
├── welib-config.json       # Site-specific configuration
├── downloaded-books.json   # Download history (auto-created)
├── welib-scraper.log      # Activity logs
└── package.json
```

## Configuration

The scraper uses these intelligent defaults:
- **Delays**: 5-15 seconds between actions
- **Servers**: Tries Server #2 first (usually faster)
- **Books per run**: 2 books maximum
- **Download path**: `./downloads/` folder
- **Duplicate threshold**: 70% title similarity

## Commands

```bash
npm start      # Download books now
npm run schedule    # Start scheduled downloads
```

## Logs

Check `welib-scraper.log` for detailed activity logs including:
- Books found and selected
- Server selection attempts
- Countdown timer progress
- Download success/failure
- Duplicate detection results

## Legal Notice

This tool is for educational purposes. Ensure you comply with welib.org's terms of service and respect copyright laws when downloading content.