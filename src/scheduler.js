const cron = require('node-cron');
const WelibScraper = require('./scraper');
const fs = require('fs-extra');
const path = require('path');

class BookScraperScheduler {
    constructor() {
        this.scraper = null;
        this.isRunning = false;
        this.config = {
            maxBooksPerRun: 10,
            schedulePattern: '0 */6 * * *', // Every 6 hours
            logFile: path.join(__dirname, '..', 'scheduler.log')
        };
    }

    async runScraping() {
        if (this.isRunning) {
            this.log('Scraper is already running, skipping this execution');
            return;
        }

        this.isRunning = true;
        this.log('Starting scheduled book scraping...');

        try {
            this.scraper = new WelibScraper();
            await this.scraper.init();
            
            const downloadedBooks = await this.scraper.scrapeBooks(this.config.maxBooksPerRun);
            
            this.log(`Scheduled run completed. Downloaded ${downloadedBooks.length} books`);
            
            // Save run statistics
            await this.saveRunStats(downloadedBooks);
            
        } catch (error) {
            this.log(`Scheduled run failed: ${error.message}`);
        } finally {
            if (this.scraper) {
                await this.scraper.close();
            }
            this.isRunning = false;
        }
    }

    async saveRunStats(downloadedBooks) {
        const statsFile = path.join(__dirname, '..', 'run-stats.json');
        
        try {
            let stats = {};
            if (await fs.pathExists(statsFile)) {
                stats = await fs.readJson(statsFile);
            }

            const runId = Date.now();
            stats[runId] = {
                timestamp: new Date().toISOString(),
                booksDownloaded: downloadedBooks.length,
                books: downloadedBooks.map(book => ({
                    title: book.title,
                    downloadedAt: book.downloadedAt,
                    size: this.getFileSize(book.downloadedPath)
                }))
            };

            await fs.writeJson(statsFile, stats, { spaces: 2 });
            this.log(`Run statistics saved to ${statsFile}`);
            
        } catch (error) {
            this.log(`Failed to save run statistics: ${error.message}`);
        }
    }

    getFileSize(filepath) {
        try {
            const stats = fs.statSync(filepath);
            return `${(stats.size / 1024 / 1024).toFixed(2)} MB`;
        } catch (error) {
            return 'Unknown';
        }
    }

    start() {
        this.log('Starting book scraper scheduler...');
        this.log(`Schedule: ${this.config.schedulePattern} (every 6 hours)`);
        this.log(`Max books per run: ${this.config.maxBooksPerRun}`);

        // Schedule the task
        cron.schedule(this.config.schedulePattern, async () => {
            await this.runScraping();
        });

        // Also run immediately on start (optional)
        this.log('Running initial scraping...');
        this.runScraping();

        this.log('Scheduler started successfully. Press Ctrl+C to stop.');
        
        // Keep the process running
        process.on('SIGINT', () => {
            this.log('Scheduler stopped by user');
            process.exit(0);
        });
    }

    // Method to run scraping manually
    async runOnce() {
        this.log('Running one-time scraping...');
        await this.runScraping();
    }

    // Update schedule
    updateSchedule(cronPattern) {
        this.config.schedulePattern = cronPattern;
        this.log(`Schedule updated to: ${cronPattern}`);
    }

    // Update max books per run
    updateMaxBooks(maxBooks) {
        this.config.maxBooksPerRun = maxBooks;
        this.log(`Max books per run updated to: ${maxBooks}`);
    }

    log(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[SCHEDULER ${timestamp}] ${message}`;
        
        console.log(logMessage);
        
        // Append to log file
        fs.appendFileSync(this.config.logFile, logMessage + '\n');
    }
}

// CLI interface
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {};
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--schedule':
                config.schedule = args[++i];
                break;
            case '--max-books':
                config.maxBooks = parseInt(args[++i]);
                break;
            case '--run-once':
                config.runOnce = true;
                break;
            case '--help':
                console.log(`
Book Scraper Scheduler Usage:

Options:
  --schedule <pattern>   Cron pattern for scheduling (default: "0 */6 * * *")
  --max-books <number>   Maximum books to download per run (default: 10)
  --run-once            Run scraping once and exit
  --help                Show this help message

Examples:
  node scheduler.js                           # Start with default settings
  node scheduler.js --run-once               # Run once and exit
  node scheduler.js --schedule "0 */12 * * *" # Run every 12 hours
  node scheduler.js --max-books 20           # Download up to 20 books per run

Cron Pattern Examples:
  "0 */6 * * *"    # Every 6 hours
  "0 */12 * * *"   # Every 12 hours
  "0 0 * * *"      # Daily at midnight
  "0 8,20 * * *"   # Daily at 8 AM and 8 PM
                `);
                process.exit(0);
                break;
        }
    }
    
    return config;
}

// Main execution
async function main() {
    const config = parseArgs();
    const scheduler = new BookScraperScheduler();
    
    // Apply configuration
    if (config.schedule) {
        scheduler.updateSchedule(config.schedule);
    }
    
    if (config.maxBooks) {
        scheduler.updateMaxBooks(config.maxBooks);
    }
    
    if (config.runOnce) {
        await scheduler.runOnce();
        process.exit(0);
    } else {
        scheduler.start();
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = BookScraperScheduler;