const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs-extra');
const path = require('path');

// Only use stealth plugin in non-parallel mode to avoid conflicts
const useParallelMode = process.argv.includes('--parallel');
if (!useParallelMode) {
    // Add stealth plugin for sequential mode only
    puppeteer.use(StealthPlugin());
}

class WelibScraper {
    constructor() {
        this.browser = null;
        this.page = null;
        this.downloadDir = path.join(__dirname, '..', 'downloads');
        this.logFile = path.join(__dirname, '..', 'welib-scraper.log');
        this.downloadedBooksFile = path.join(__dirname, '..', 'downloaded-books.json');
        this.config = require('../welib-config.json');
        this.downloadedBooks = new Set();
    }

    async init() {
        try {
            await fs.ensureDir(this.downloadDir);
            
            // Load previously downloaded books list
            await this.loadDownloadedBooksList();
            
            console.log('🚀 Starting Welib scraper with Brave...');
            
            // Try to find Brave browser
            const bravePaths = [
                '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
            ];
            
            let executablePath = null;
            for (const path of bravePaths) {
                if (await fs.pathExists(path)) {
                    executablePath = path;
                    break;
                }
            }
            
            this.browser = await puppeteer.launch({
                headless: false, // Keep visible for debugging
                executablePath: executablePath,
                args: [
                    '--start-maximized',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-popup-blocking',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--disable-infobars',
                    '--disable-extensions',
                    '--no-default-browser-check',
                    '--disable-default-apps'
                ],
                defaultViewport: null
            });
            
            this.page = await this.browser.newPage();
            
            // Set realistic headers
            await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Handle download behavior and popups
            await this.setupDownloadHandling();
            
            this.log('✅ Welib scraper initialized successfully');
            
        } catch (error) {
            this.log(`❌ Failed to initialize: ${error.message}`);
            throw error;
        }
    }

    async setupDownloadHandling() {
        try {
            await this.setupDownloadHandlingForPage(this.page);
            
            // Handle new page/popup events (browser-level) with stealth plugin compatibility
            this.browser.on('targetcreated', async target => {
                if (target.type() === 'page') {
                    try {
                        // Wait a moment for stealth plugin to initialize
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                        const newPage = await target.page();
                        const url = target.url();
                        
                        // Only close unwanted popups, not our main tabs
                        if (url && !url.includes('welib.org') && !url.startsWith('about:blank')) {
                            this.log(`🪟 Closing unwanted popup: ${url.substring(0, 50)}...`);
                            await newPage.close();
                        } else {
                            this.log(`📑 Allowing welib page/tab: ${url}`);
                        }
                    } catch (error) {
                        // Ignore errors from popup handling to prevent stealth plugin conflicts
                        this.log(`⚠️ Popup handling error (ignoring): ${error.message}`);
                    }
                }
            });
            
            this.log('💾 Download handling setup complete');
            
        } catch (error) {
            this.log(`⚠️ Could not setup download handling: ${error.message}`);
        }
    }

    async setupDownloadHandlingForPage(page) {
        try {
            // Set download behavior to automatically save files
            const client = await page.target().createCDPSession();
            await client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: this.downloadDir
            });
            
            // Handle dialog events (including download dialogs)
            page.on('dialog', async dialog => {
                this.log(`🔔 Dialog detected on page: ${dialog.type()} - ${dialog.message()}`);
                await dialog.accept();
            });
            
            this.log('💾 Download handling setup for page complete');
            
        } catch (error) {
            this.log(`⚠️ Could not setup download handling for page: ${error.message}`);
        }
    }

    async handleBravePopups() {
        try {
            this.log('🛡️ Checking for Brave popups...');
            
            // Look for common Brave popup elements
            const popupSelectors = [
                '[data-test-id="dialog"]',
                '.popup-content',
                '[role="dialog"]',
                '.notification-popup',
                'button[data-test-id="continue-download"]'
            ];
            
            for (const selector of popupSelectors) {
                try {
                    const popup = await this.page.$(selector);
                    if (popup) {
                        this.log(`🎯 Found Brave popup: ${selector}`);
                        
                        // Try to find and click continue/dismiss buttons
                        const continueButton = await this.page.$('button:contains("Continue"), button:contains("Allow"), button:contains("Dismiss")');
                        if (continueButton) {
                            await this.humanLikeClick(continueButton, 'popup dismiss button');
                        } else {
                            // Try pressing Escape to close popup
                            await this.page.keyboard.press('Escape');
                            this.log('⌨️ Pressed Escape to dismiss popup');
                        }
                        
                        await this.randomDelay(1000, 2000);
                    }
                } catch (e) {
                    continue;
                }
            }
            
        } catch (error) {
            this.log(`⚠️ Error handling Brave popups: ${error.message}`);
        }
    }

    async loadMoreBooksIfNeeded() {
        try {
            this.log('📚 Checking for "Load More" button...');
            
            // Look for the Load More button
            const loadMoreButton = await this.page.$('#load-more-button');
            if (loadMoreButton) {
                this.log('🔽 Found "Load More" button - clicking to get more books');
                
                const success = await this.humanLikeClick(loadMoreButton, 'Load More button');
                if (success) {
                    // Wait for new books to load
                    await this.randomDelay(5000, 8000);
                    this.log('✅ More books should be loaded now');
                    return true;
                }
            } else {
                this.log('📚 No "Load More" button found');
            }
            
        } catch (error) {
            this.log(`⚠️ Error loading more books: ${error.message}`);
        }
        return false;
    }

    async loadDownloadedBooksList() {
        try {
            if (await fs.pathExists(this.downloadedBooksFile)) {
                const data = await fs.readJson(this.downloadedBooksFile);
                this.downloadedBooks = new Set(data.books || []);
                this.log(`📚 Loaded ${this.downloadedBooks.size} previously downloaded books`);
            } else {
                this.downloadedBooks = new Set();
                this.log('📚 No previous download history found - starting fresh');
            }
            
            // Also scan existing files in downloads folder
            await this.scanExistingDownloads();
            
        } catch (error) {
            this.log(`⚠️ Could not load download history: ${error.message}`);
            this.downloadedBooks = new Set();
        }
    }

    async scanExistingDownloads() {
        try {
            const files = await fs.readdir(this.downloadDir);
            const bookFiles = files.filter(file => 
                file.endsWith('.pdf') || 
                file.endsWith('.epub') || 
                file.endsWith('.mobi')
            );
            
            let addedFromFiles = 0;
            bookFiles.forEach(filename => {
                // Extract book title from filename (remove WeLib.org suffix and extensions)
                let bookTitle = filename
                    .replace(/\s*--\s*WeLib\.org\s*/gi, '')
                    .replace(/\.(pdf|epub|mobi)$/i, '')
                    .replace(/_\d+$/, '') // Remove timestamp suffix
                    .replace(/_/g, ' ')
                    .trim();
                
                const normalizedTitle = this.normalizeBookTitle(bookTitle);
                if (!this.downloadedBooks.has(normalizedTitle)) {
                    this.downloadedBooks.add(normalizedTitle);
                    addedFromFiles++;
                }
            });
            
            if (addedFromFiles > 0) {
                this.log(`📁 Added ${addedFromFiles} books from existing files`);
                await this.saveDownloadedBooksList();
            }
            
        } catch (error) {
            this.log(`⚠️ Could not scan existing downloads: ${error.message}`);
        }
    }

    async saveDownloadedBooksList() {
        try {
            const data = {
                lastUpdated: new Date().toISOString(),
                totalBooks: this.downloadedBooks.size,
                books: Array.from(this.downloadedBooks)
            };
            await fs.writeJson(this.downloadedBooksFile, data, { spaces: 2 });
            this.log(`💾 Saved download history: ${this.downloadedBooks.size} books`);
        } catch (error) {
            this.log(`⚠️ Could not save download history: ${error.message}`);
        }
    }

    normalizeBookTitle(title) {
        // Normalize title for comparison (remove special characters, extra spaces, etc.)
        return title
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    isBookAlreadyDownloaded(bookTitle) {
        const normalizedTitle = this.normalizeBookTitle(bookTitle);
        
        // Check if exact title exists
        if (this.downloadedBooks.has(normalizedTitle)) {
            return true;
        }
        
        // Check for similar titles (fuzzy matching)
        for (const downloadedTitle of this.downloadedBooks) {
            // Simple fuzzy match - check if 80% of words are the same
            const downloadedWords = downloadedTitle.split(' ');
            const currentWords = normalizedTitle.split(' ');
            
            const commonWords = currentWords.filter(word => 
                word.length > 3 && downloadedWords.includes(word)
            );
            
            const similarity = commonWords.length / Math.max(currentWords.length, downloadedWords.length);
            if (similarity > 0.7) { // 70% similarity threshold
                this.log(`📖 Similar book found: "${bookTitle}" ≈ "${downloadedTitle}"`);
                return true;
            }
        }
        
        return false;
    }

    markBookAsDownloaded(bookTitle) {
        const normalizedTitle = this.normalizeBookTitle(bookTitle);
        this.downloadedBooks.add(normalizedTitle);
        this.log(`✅ Marked as downloaded: ${bookTitle}`);
    }

    async randomDelay(min = 1000, max = 3000) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        this.log(`⏳ Waiting ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    async humanLikeClick(element, description = 'element') {
        try {
            this.log(`🎯 About to click: ${description}`);
            
            // Scroll element into view
            await element.scrollIntoView({ behavior: 'smooth' });
            await this.randomDelay(1000, 2000);
            
            // Get element position for human-like clicking
            const box = await element.boundingBox();
            if (box) {
                // Move to element with slight randomness
                const x = box.x + box.width / 2 + (Math.random() - 0.5) * 10;
                const y = box.y + box.height / 2 + (Math.random() - 0.5) * 10;
                
                await this.page.mouse.move(x, y, { steps: 5 });
                await this.randomDelay(200, 500);
                
                // Hover before clicking
                await element.hover();
                await this.randomDelay(300, 800);
                
                // Click
                await element.click();
                this.log(`✅ Clicked: ${description}`);
                
                return true;
            }
        } catch (error) {
            this.log(`❌ Failed to click ${description}: ${error.message}`);
            return false;
        }
    }

    async navigateToWelib() {
        try {
            this.log('🔗 Navigating to welib.org...');
            await this.page.goto('https://welib.org/', { 
                waitUntil: 'networkidle2',
                timeout: 60000 
            });
            
            // Wait for any loading screens to complete
            await this.randomDelay(5000, 10000);
            
            this.log('✅ Successfully loaded welib.org');
            return true;
            
        } catch (error) {
            this.log(`❌ Failed to navigate: ${error.message}`);
            return false;
        }
    }

    async scrollAndFindBooks() {
        try {
            this.log('📜 Scrolling to discover more books...');
            
            // Initial scroll and wait
            await this.page.evaluate(() => {
                window.scrollTo(0, window.innerHeight * 0.5);
            });
            await this.randomDelay(2000, 4000);
            
            // Scroll more to load additional books
            await this.page.evaluate(() => {
                window.scrollTo(0, window.innerHeight * 1.5);
            });
            await this.randomDelay(3000, 5000);
            
            // Check for "Load More" button and click it if available
            const loadedMore = await this.loadMoreBooksIfNeeded();
            if (loadedMore) {
                // Scroll again after loading more books
                await this.page.evaluate(() => {
                    window.scrollTo(0, window.innerHeight * 2);
                });
                await this.randomDelay(2000, 4000);
            }
            
            // Scroll back to top
            await this.page.evaluate(() => {
                window.scrollTo(0, 0);
            });
            await this.randomDelay(1000, 2000);
            
            this.log('✅ Scrolling complete, books should be loaded');
            
        } catch (error) {
            this.log(`❌ Error during scrolling: ${error.message}`);
        }
    }

    async findBookTitles() {
        try {
            this.log('🔍 Looking for book titles...');
            
            // First scroll to discover more books
            await this.scrollAndFindBooks();
            
            // Wait for book titles to load
            await this.page.waitForSelector('h2.font-semibold', { timeout: 30000 });
            
            // Get all book title elements with their parent links
            const bookElements = await this.page.evaluate(() => {
                const books = [];
                const titles = document.querySelectorAll('h2.font-semibold.text-md.md\\:text-lg.dark\\:text-slate-300.dark\\:hover\\:text-slate-100.line-clamp-3.mb-1.w-full.owa');
                
                titles.forEach(title => {
                    const parentLink = title.closest('a');
                    if (parentLink) {
                        books.push({
                            element: title,
                            link: parentLink,
                            title: title.textContent.trim(),
                            href: parentLink.href
                        });
                    }
                });
                
                return books;
            });
            
            this.log(`📚 Found ${bookElements.length} book titles`);
            
            // Log some book titles for variety
            bookElements.slice(0, 3).forEach((book, index) => {
                this.log(`📖 Book ${index + 1}: ${book.title.substring(0, 50)}...`);
            });
            
            return bookElements;
            
        } catch (error) {
            this.log(`❌ Error finding book titles: ${error.message}`);
            return [];
        }
    }

    async clickBookTitle(bookElement) {
        try {
            const bookTitle = await this.page.evaluate(el => el.textContent, bookElement);
            this.log(`📖 Clicking book: ${bookTitle.substring(0, 50)}...`);
            
            // Scroll to book and click
            await bookElement.scrollIntoView({ behavior: 'smooth' });
            await this.randomDelay(2000, 4000);
            
            const success = await this.humanLikeClick(bookElement, 'book title');
            if (success) {
                // Wait for book page to load
                await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
                await this.randomDelay(3000, 6000);
                return true;
            }
            
        } catch (error) {
            this.log(`❌ Error clicking book: ${error.message}`);
        }
        return false;
    }

    async findAndClickDownloadButton() {
        try {
            this.log('🔽 Looking for download servers...');
            
            // Wait for download buttons to load
            await this.page.waitForSelector('.js-download-link', { timeout: 15000 });
            
            // Get all download buttons (Server #1 and Server #2)
            const downloadButtons = await this.page.$$('.js-download-link');
            this.log(`🌐 Found ${downloadButtons.length} download servers`);
            
            // Try Server #2 first (usually faster), then Server #1
            const serverOrder = downloadButtons.length > 1 ? [1, 0] : [0];
            
            for (const serverIndex of serverOrder) {
                if (serverIndex < downloadButtons.length) {
                    try {
                        this.log(`🌐 Trying Server #${serverIndex + 1}...`);
                        
                        const downloadButton = downloadButtons[serverIndex];
                        const success = await this.humanLikeClick(downloadButton, `Server #${serverIndex + 1} download`);
                        
                        if (success) {
                            // Wait for download page to load
                            await this.randomDelay(3000, 6000);
                            return { success: true, server: serverIndex + 1 };
                        }
                    } catch (e) {
                        this.log(`❌ Server #${serverIndex + 1} failed: ${e.message}`);
                        continue;
                    }
                }
            }
            
        } catch (error) {
            this.log(`❌ Error finding download servers: ${error.message}`);
        }
        return { success: false, server: null };
    }

    async waitForCountdown() {
        try {
            this.log('⏰ Waiting for download countdown...');
            
            // Wait a moment for page to stabilize after click
            await this.randomDelay(3000, 5000);
            
            // First check for "Please wait" text to confirm we're on countdown page
            const pleaseWaitFound = await this.page.evaluate(() => {
                const text = document.body.innerText.toLowerCase();
                return text.includes('please wait') && text.includes('seconds');
            });
            
            if (!pleaseWaitFound) {
                this.log('⚡ No "Please wait" countdown found, proceeding immediately');
                return true;
            }
            
            this.log('⏳ Found "Please wait" message, looking for countdown...');
            
            // Try multiple selectors to find countdown
            const countdownSelectors = ['.js-partner-countdown', '.countdown', '[class*="countdown"]'];
            let countdownElement = null;
            
            for (const selector of countdownSelectors) {
                try {
                    countdownElement = await this.page.$(selector);
                    if (countdownElement) {
                        this.log(`📍 Found countdown element: ${selector}`);
                        break;
                    }
                } catch (e) {
                    continue;
                }
            }
            
            if (!countdownElement) {
                this.log('⚠️ No countdown element found, but "Please wait" detected. Using text extraction...');
            }
            
            // Get initial countdown value using multiple methods
            let initialTime = 0;
            
            // Method 1: Try specific countdown selectors
            for (const selector of countdownSelectors) {
                try {
                    const time = await this.page.evaluate((sel) => {
                        const element = document.querySelector(sel);
                        if (element) {
                            const text = element.textContent;
                            const match = text.match(/(\d+)/);
                            return match ? parseInt(match[1]) : 0;
                        }
                        return 0;
                    }, selector);
                    
                    if (time > 0) {
                        initialTime = time;
                        this.log(`⏳ Found countdown: ${initialTime} seconds (selector: ${selector})`);
                        break;
                    }
                } catch (e) {
                    this.log(`⚠️ Error with selector ${selector}: ${e.message}`);
                    continue;
                }
            }
            
            // Method 2: Extract from "Please wait X seconds" text if no element found
            if (initialTime === 0) {
                try {
                    initialTime = await this.page.evaluate(() => {
                        const text = document.body.innerText;
                        const match = text.match(/please wait[^\d]*(\d+)[^\d]*seconds/i);
                        return match ? parseInt(match[1]) : 0;
                    });
                    
                    if (initialTime > 0) {
                        this.log(`⏳ Extracted countdown from text: ${initialTime} seconds`);
                    }
                } catch (e) {
                    this.log(`⚠️ Could not extract countdown from text: ${e.message}`);
                }
            }
            
            if (initialTime === 0) {
                this.log('⚠️ Could not determine countdown time, waiting with default delay');
                await this.randomDelay(30000, 60000); // Wait 30-60 seconds by default
                return true;
            }
            this.log(`⏳ Download countdown: ${initialTime} seconds`);
            
            if (initialTime > 0) {
                // Wait for countdown with periodic checks
                let remainingTime = initialTime;
                
                while (remainingTime > 0) {
                    await this.randomDelay(10000, 15000); // Check every 10-15 seconds
                    
                    try {
                        const currentTime = await this.page.evaluate(() => {
                            const element = document.querySelector('.js-partner-countdown');
                            return element ? parseInt(element.textContent) : 0;
                        });
                        
                        if (currentTime <= 0) {
                            break;
                        }
                        
                        remainingTime = currentTime;
                        this.log(`⏳ Still waiting: ${remainingTime} seconds remaining`);
                        
                        // Simulate some human activity during wait
                        if (Math.random() < 0.3) {
                            await this.page.mouse.move(
                                Math.random() * 500 + 100,
                                Math.random() * 500 + 100,
                                { steps: 3 }
                            );
                        }
                        
                    } catch (e) {
                        // Continue if evaluation fails
                    }
                }
            }
            
            this.log('✅ Countdown completed!');
            await this.randomDelay(2000, 4000);
            return true;
            
        } catch (error) {
            this.log(`❌ Error during countdown: ${error.message}`);
            return false;
        }
    }

    async findAndClickFinalDownload() {
        try {
            this.log('📥 Looking for final download link...');
            
            // Look for the final download link
            const selectors = [
                'p.mb-4.text-xl.font-bold a',
                'a[href*="welib-public.org"]',
                'a[href$=".pdf"]'
            ];
            
            for (const selector of selectors) {
                try {
                    await this.page.waitForSelector(selector, { timeout: 10000 });
                    const downloadLink = await this.page.$(selector);
                    
                    if (downloadLink) {
                        const href = await this.page.evaluate(el => el.href, downloadLink);
                        this.log(`🎯 Found download link: ${href.substring(0, 50)}...`);
                        
                        // Set download behavior to automatically save files
                        try {
                            await this.page._client.send('Page.setDownloadBehavior', {
                                behavior: 'allow',
                                downloadPath: this.downloadDir
                            });
                            this.log('💾 Set download path to: ' + this.downloadDir);
                        } catch (e) {
                            this.log('⚠️ Could not set download path, will handle dialog manually');
                        }
                        
                        const success = await this.humanLikeClick(downloadLink, 'final download link');
                        if (success) {
                            this.log('⏳ Waiting for download dialog...');
                            await this.randomDelay(3000, 6000);
                            
                            // Try to handle macOS download dialog
                            await this.handleMacDownloadDialog();
                            
                            await this.randomDelay(5000, 10000);
                            return { success: true, url: href };
                        }
                    }
                } catch (e) {
                    continue;
                }
            }
            
        } catch (error) {
            this.log(`❌ Error finding final download: ${error.message}`);
        }
        
        return { success: false, url: null };
    }

    async downloadFileToFolder(downloadUrl, bookTitle) {
        try {
            this.log(`📥 Downloading file: ${bookTitle}`);
            this.log(`🔗 URL: ${downloadUrl.substring(0, 80)}...`);
            
            // Clean title for filename
            const cleanTitle = bookTitle
                .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
                .replace(/\s+/g, ' ') // Replace multiple spaces with single space
                .trim()
                .substring(0, 100); // Limit length to 100 chars
            
            // Extract file extension from URL
            let extension = '.pdf'; // Default to PDF
            const urlPath = downloadUrl.split('?')[0]; // Remove query parameters
            const urlExtension = path.extname(urlPath);
            if (urlExtension && ['.pdf', '.epub', '.mobi'].includes(urlExtension.toLowerCase())) {
                extension = urlExtension.toLowerCase();
            }
            
            // Create filename with timestamp to avoid duplicates
            const timestamp = Date.now();
            const filename = `${cleanTitle}_${timestamp}${extension}`;
            const filepath = path.join(this.downloadDir, filename);
            
            this.log(`💾 Saving to: ${filename}`);
            
            // Download the file using axios
            const axios = require('axios');
            const response = await axios({
                method: 'GET',
                url: downloadUrl,
                responseType: 'stream',
                timeout: 300000, // 5 minutes timeout
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive'
                }
            });
            
            // Create write stream and pipe the response
            const writer = fs.createWriteStream(filepath);
            response.data.pipe(writer);
            
            return new Promise((resolve) => {
                writer.on('finish', async () => {
                    try {
                        // Check if file was actually written and has content
                        const stats = await fs.stat(filepath);
                        const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
                        
                        if (stats.size > 0) {
                            this.log(`✅ Downloaded successfully: ${filename} (${fileSizeMB} MB)`);
                            resolve(filepath);
                        } else {
                            this.log(`❌ Downloaded file is empty: ${filename}`);
                            // Try to remove empty file
                            await fs.remove(filepath);
                            resolve(null);
                        }
                    } catch (error) {
                        this.log(`❌ Error checking downloaded file: ${error.message}`);
                        resolve(null);
                    }
                });
                
                writer.on('error', async (error) => {
                    this.log(`❌ Error writing file: ${error.message}`);
                    // Try to remove partial file
                    try {
                        await fs.remove(filepath);
                    } catch (e) {
                        // Ignore cleanup errors
                    }
                    resolve(null);
                });
                
                // Handle download errors
                response.data.on('error', async (error) => {
                    this.log(`❌ Error downloading file: ${error.message}`);
                    try {
                        await fs.remove(filepath);
                    } catch (e) {
                        // Ignore cleanup errors
                    }
                    resolve(null);
                });
            });
            
        } catch (error) {
            this.log(`❌ Failed to download file: ${error.message}`);
            return null;
        }
    }

    async handleMacDownloadDialog() {
        try {
            this.log('🍎 Attempting to handle macOS download dialog...');
            
            await this.randomDelay(2000, 4000);
            
            // Try different keyboard shortcuts to confirm download
            this.log('⌨️ Trying Enter key...');
            await this.page.keyboard.press('Enter');
            await this.randomDelay(1000, 2000);
            
            // Try Return key (alternative) - use NumpadEnter instead
            this.log('⌨️ Trying NumpadEnter key...');
            await this.page.keyboard.press('NumpadEnter');
            await this.randomDelay(1000, 2000);
            
            // Try Cmd+S (Save shortcut)
            this.log('⌨️ Trying Cmd+S...');
            await this.page.keyboard.down('Meta');
            await this.page.keyboard.press('KeyS');
            await this.page.keyboard.up('Meta');
            await this.randomDelay(1000, 2000);
            
            // Try Space (might select default button)
            this.log('⌨️ Trying Space bar...');
            await this.page.keyboard.press('Space');
            await this.randomDelay(1000, 2000);
            
            // Try Tab + Enter (navigate to Save button)
            this.log('⌨️ Trying Tab + Enter...');
            await this.page.keyboard.press('Tab');
            await this.randomDelay(500, 1000);
            await this.page.keyboard.press('Enter');
            
            this.log('✅ Attempted all download dialog shortcuts');
            return true;
            
        } catch (error) {
            this.log(`❌ Error handling download dialog: ${error.message}`);
            return false;
        }
    }

    async scrapeMultipleBooks(maxBooks = 3) {
        try {
            this.log(`🎯 Starting scrape of up to ${maxBooks} books...`);
            
            const results = [];
            
            for (let bookIndex = 0; bookIndex < maxBooks; bookIndex++) {
                this.log(`📚 === BOOK ${bookIndex + 1}/${maxBooks} ===`);
                
                // Handle any Brave popups before starting
                await this.handleBravePopups();
                
                const result = await this.scrapeBook(bookIndex);
                if (result) {
                    results.push(result);
                    this.log(`✅ Book ${bookIndex + 1} completed successfully`);
                } else {
                    this.log(`❌ Book ${bookIndex + 1} failed`);
                }
                
                // Handle any remaining popups after download
                await this.handleBravePopups();
                
                // Long delay between books to avoid rate limiting
                if (bookIndex < maxBooks - 1) {
                    this.log('⏳ Waiting between books...');
                    await this.randomDelay(30000, 60000); // 30-60 seconds
                    
                    // Navigate back to main page for next book
                    await this.page.goto('https://welib.org/', { waitUntil: 'networkidle2' });
                    await this.randomDelay(5000, 10000);
                    
                    // Handle popups after navigation
                    await this.handleBravePopups();
                }
            }
            
            return results;
            
        } catch (error) {
            this.log(`❌ Error during multiple book scrape: ${error.message}`);
            return [];
        }
    }

    async scrapeParallelBooks(maxBooks = 6, parallelTabs = 3) {
        try {
            this.log(`🚀 Starting PARALLEL scrape: ${maxBooks} books across ${parallelTabs} tabs`);
            
            // Create multiple tabs for parallel processing
            const tabs = [];
            for (let i = 0; i < parallelTabs; i++) {
                const newPage = await this.browser.newPage();
                await newPage.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                
                // Setup download handling for this specific tab
                await this.setupDownloadHandlingForPage(newPage);
                
                tabs.push(newPage);
                this.log(`📑 Created tab ${i + 1}/${parallelTabs}`);
            }
            
            // Get initial list of books from first tab
            await tabs[0].goto('https://welib.org/', { waitUntil: 'networkidle2' });
            await this.randomDelay(3000, 5000);
            
            const bookTitles = await this.findBookTitlesOnPage(tabs[0]);
            this.log(`📚 Found ${bookTitles.length} total books for parallel processing`);
            
            if (bookTitles.length === 0) {
                this.log('❌ No books found for parallel processing');
                return [];
            }
            
            // Create batches for parallel processing
            const booksToProcess = bookTitles.slice(0, maxBooks);
            const batchSize = Math.ceil(booksToProcess.length / parallelTabs);
            const batches = [];
            
            for (let i = 0; i < parallelTabs; i++) {
                const start = i * batchSize;
                const end = Math.min(start + batchSize, booksToProcess.length);
                if (start < booksToProcess.length) {
                    batches.push({
                        tab: tabs[i],
                        books: booksToProcess.slice(start, end),
                        tabIndex: i + 1
                    });
                }
            }
            
            this.log(`🎯 Created ${batches.length} parallel batches`);
            
            // Process batches in parallel
            const batchPromises = batches.map(batch => 
                this.processBatchInTab(batch.tab, batch.books, batch.tabIndex)
            );
            
            const batchResults = await Promise.all(batchPromises);
            const results = batchResults.flat().filter(result => result !== null);
            
            // Close additional tabs (keep original tab)
            for (let i = 1; i < tabs.length; i++) {
                await tabs[i].close();
                this.log(`🗑️ Closed tab ${i + 1}`);
            }
            
            this.log(`✅ Parallel processing complete: ${results.length}/${maxBooks} books downloaded`);
            return results;
            
        } catch (error) {
            this.log(`❌ Error during parallel scrape: ${error.message}`);
            return [];
        }
    }

    async processBatchInTab(page, books, tabIndex) {
        const results = [];
        
        try {
            this.log(`📑 Tab ${tabIndex}: Processing ${books.length} books`);
            
            for (let i = 0; i < books.length; i++) {
                const book = books[i];
                this.log(`📑 Tab ${tabIndex}: Book ${i + 1}/${books.length}: ${book.title.substring(0, 40)}...`);
                
                // Check if already downloaded
                if (this.isBookAlreadyDownloaded(book.title)) {
                    this.log(`📑 Tab ${tabIndex}: ⏭️ Skipping already downloaded: ${book.title.substring(0, 40)}...`);
                    continue;
                }
                
                const result = await this.scrapeBookInTab(page, book, tabIndex);
                if (result) {
                    results.push(result);
                    this.log(`📑 Tab ${tabIndex}: ✅ Completed: ${book.title.substring(0, 40)}...`);
                    
                    // Mark as downloaded immediately
                    this.markBookAsDownloaded(book.title);
                } else {
                    this.log(`📑 Tab ${tabIndex}: ❌ Failed: ${book.title.substring(0, 40)}...`);
                }
                
                // Shorter delay between books in parallel mode
                if (i < books.length - 1) {
                    await this.randomDelay(10000, 20000); // 10-20 seconds
                }
            }
            
        } catch (error) {
            this.log(`📑 Tab ${tabIndex}: ❌ Batch processing error: ${error.message}`);
        }
        
        return results;
    }

    async findBookTitlesOnPage(page) {
        try {
            // Scroll and load more books on this specific page
            await page.evaluate(() => {
                window.scrollTo(0, window.innerHeight * 1.5);
            });
            await this.randomDelay(3000, 5000);
            
            // Check for "Load More" button
            const loadMoreButton = await page.$('#load-more-button');
            if (loadMoreButton) {
                await loadMoreButton.click();
                await this.randomDelay(5000, 8000);
            }
            
            // Get all book titles from this page
            const bookElements = await page.evaluate(() => {
                const books = [];
                const titles = document.querySelectorAll('h2.font-semibold.text-md.md\\:text-lg.dark\\:text-slate-300.dark\\:hover\\:text-slate-100.line-clamp-3.mb-1.w-full.owa');
                
                titles.forEach(title => {
                    const parentLink = title.closest('a');
                    if (parentLink) {
                        books.push({
                            title: title.textContent.trim(),
                            href: parentLink.href
                        });
                    }
                });
                
                return books;
            });
            
            this.log(`📚 Found ${bookElements.length} books on page`);
            return bookElements;
            
        } catch (error) {
            this.log(`❌ Error finding book titles on page: ${error.message}`);
            return [];
        }
    }

    async scrapeBookInTab(page, selectedBook, tabIndex) {
        try {
            // Navigate to the book page
            await page.goto(selectedBook.href, { waitUntil: 'networkidle2' });
            await this.randomDelay(3000, 6000);
            
            // Find and click download button
            const downloadButtons = await page.$$('.js-download-link');
            if (downloadButtons.length === 0) {
                this.log(`📑 Tab ${tabIndex}: ❌ No download buttons found`);
                return null;
            }
            
            // Try Server #2 first, then Server #1
            const serverIndex = downloadButtons.length > 1 ? 1 : 0;
            const downloadButton = downloadButtons[serverIndex];
            
            await downloadButton.click();
            this.log(`📑 Tab ${tabIndex}: 🌐 Clicked Server #${serverIndex + 1}`);
            await this.randomDelay(3000, 6000);
            
            // Wait for countdown with simplified approach for parallel processing
            await this.waitForCountdownInTab(page, tabIndex);
            
            // Find and get final download URL
            const finalDownload = await this.findFinalDownloadInTab(page, tabIndex);
            if (finalDownload.success) {
                // Download the file
                const downloadedFile = await this.downloadFileToFolder(finalDownload.url, selectedBook.title);
                
                if (downloadedFile) {
                    return {
                        success: true,
                        bookTitle: selectedBook.title,
                        bookUrl: selectedBook.href,
                        server: serverIndex + 1,
                        downloadUrl: finalDownload.url,
                        downloadedFile: downloadedFile,
                        timestamp: new Date().toISOString(),
                        tabIndex: tabIndex
                    };
                }
            }
            
            return null;
            
        } catch (error) {
            this.log(`📑 Tab ${tabIndex}: ❌ Error scraping book: ${error.message}`);
            return null;
        }
    }

    async waitForCountdownInTab(page, tabIndex) {
        try {
            // Simplified countdown waiting for parallel processing
            await this.randomDelay(5000, 10000); // Wait for page to stabilize
            
            // Check for countdown and wait appropriately
            const countdownTime = await page.evaluate(() => {
                const text = document.body.innerText.toLowerCase();
                if (text.includes('please wait') && text.includes('seconds')) {
                    const match = text.match(/please wait[^\d]*(\d+)[^\d]*seconds/i);
                    return match ? parseInt(match[1]) : 300; // Default 5 minutes
                }
                return 0;
            });
            
            if (countdownTime > 0) {
                this.log(`📑 Tab ${tabIndex}: ⏰ Waiting ${countdownTime} seconds...`);
                // Wait the full countdown time plus buffer
                await this.randomDelay((countdownTime + 10) * 1000, (countdownTime + 20) * 1000);
            }
            
        } catch (error) {
            this.log(`📑 Tab ${tabIndex}: ⚠️ Countdown error: ${error.message}`);
            // Default wait if countdown detection fails
            await this.randomDelay(300000, 330000); // 5-5.5 minutes
        }
    }

    async findFinalDownloadInTab(page, tabIndex) {
        try {
            const selectors = [
                'p.mb-4.text-xl.font-bold a',
                'a[href*="welib-public.org"]',
                'a[href$=".pdf"]',
                'a[href$=".epub"]',
                'a[href$=".mobi"]'
            ];
            
            for (const selector of selectors) {
                try {
                    await page.waitForSelector(selector, { timeout: 10000 });
                    const downloadLink = await page.$(selector);
                    
                    if (downloadLink) {
                        const href = await page.evaluate(el => el.href, downloadLink);
                        this.log(`📑 Tab ${tabIndex}: 🎯 Found final download: ${href.substring(0, 50)}...`);
                        return { success: true, url: href };
                    }
                } catch (e) {
                    continue;
                }
            }
            
            return { success: false, url: null };
            
        } catch (error) {
            this.log(`📑 Tab ${tabIndex}: ❌ Error finding final download: ${error.message}`);
            return { success: false, url: null };
        }
    }

    async scrapeBook(_bookIndex = 0) {
        try {
            this.log('🎯 Starting single book scrape...');
            
            // Step 1: Navigate to site
            const navigated = await this.navigateToWelib();
            if (!navigated) return null;
            
            // Step 2: Find and click book title
            const bookTitles = await this.findBookTitles();
            if (bookTitles.length === 0) {
                this.log('❌ No book titles found');
                return null;
            }
            
            // Find a book that hasn't been downloaded yet
            let selectedBook = null;
            let attempts = 0;
            const maxAttempts = Math.min(bookTitles.length, 20); // Try up to 20 books
            
            while (!selectedBook && attempts < maxAttempts) {
                const randomIndex = Math.floor(Math.random() * bookTitles.length);
                const candidateBook = bookTitles[randomIndex];
                
                if (!this.isBookAlreadyDownloaded(candidateBook.title)) {
                    selectedBook = candidateBook;
                    this.log(`📖 Selected new book: ${selectedBook.title.substring(0, 50)}...`);
                } else {
                    this.log(`⏭️ Skipping already downloaded: ${candidateBook.title.substring(0, 50)}...`);
                    attempts++;
                }
            }
            
            if (!selectedBook) {
                this.log('❌ Could not find any new books to download (all may be downloaded already)');
                return null;
            }
            
            // Navigate to the book page using the href
            await this.page.goto(selectedBook.href, { waitUntil: 'networkidle2' });
            await this.randomDelay(3000, 6000);
            
            // Step 3: Click download button (try different servers)
            const downloadResult = await this.findAndClickDownloadButton();
            if (!downloadResult.success) return null;
            
            this.log(`✅ Using Server #${downloadResult.server} for download`);
            
            // Step 4: Wait for countdown
            const countdownComplete = await this.waitForCountdown();
            if (!countdownComplete) return null;
            
            // Step 5: Click final download
            const finalDownload = await this.findAndClickFinalDownload();
            if (finalDownload.success) {
                // Actually download the file to downloads folder
                const downloadedFile = await this.downloadFileToFolder(finalDownload.url, selectedBook.title);
                
                if (downloadedFile) {
                    // Mark book as downloaded and save the list
                    this.markBookAsDownloaded(selectedBook.title);
                    await this.saveDownloadedBooksList();
                    
                    return {
                        success: true,
                        bookTitle: selectedBook.title,
                        bookUrl: selectedBook.href,
                        server: downloadResult.server,
                        downloadUrl: finalDownload.url,
                        downloadedFile: downloadedFile,
                        timestamp: new Date().toISOString()
                    };
                } else {
                    this.log('❌ Failed to download file to folder');
                    return null;
                }
            }
            
            return null;
            
        } catch (error) {
            this.log(`❌ Error during scraping: ${error.message}`);
            return null;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.log('🔒 Browser closed');
        }
    }

    log(message) {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}`;
        
        console.log(logMessage);
        
        // Append to log file
        fs.appendFileSync(this.logFile, logMessage + '\n');
    }
}

// Main execution
async function main() {
    console.log('🎯 WELIB.ORG AUTOMATED SCRAPER');
    console.log('==============================');
    console.log('Using captured selectors from manual inspection');
    console.log('');
    
    const scraper = new WelibScraper();
    
    try {
        await scraper.init();
        
        // Choose scraping mode: parallel (faster) or sequential (safer)
        const useParallelMode = process.argv.includes('--parallel');
        
        let results;
        if (useParallelMode) {
            // PARALLEL MODE: 6 books across 3 tabs (much faster!)
            results = await scraper.scrapeParallelBooks(6, 3);
        } else {
            // SEQUENTIAL MODE: 2 books one by one (safer)
            results = await scraper.scrapeMultipleBooks(2);
        }
        
        if (results.length > 0) {
            console.log('✅ SUCCESS!');
            console.log(`📚 Downloaded ${results.length} books:`);
            
            results.forEach((result, index) => {
                console.log(`\n📖 Book ${index + 1}:`);
                console.log(`   📝 Title: ${result.bookTitle}`);
                console.log(`   🌐 Server: #${result.server}`);
                console.log(`   📥 Download URL: ${result.downloadUrl}`);
                if (result.downloadedFile) {
                    console.log(`   💾 Downloaded File: ${path.basename(result.downloadedFile)}`);
                    console.log(`   📁 Location: ${result.downloadedFile}`);
                }
                console.log(`   📅 Completed: ${result.timestamp}`);
            });
        } else {
            console.log('❌ No books downloaded - check logs for details');
        }
        
    } catch (error) {
        console.error('❌ Scraper failed:', error.message);
    } finally {
        await scraper.close();
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = WelibScraper;