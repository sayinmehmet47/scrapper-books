const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs-extra');
const path = require('path');

// Add stealth plugin for better bot detection evasion
puppeteer.use(StealthPlugin());

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
                        this.log(`⚠️ Error handling new target: ${error.message}`);
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
            
            this.log('💾 Download handling setup for page complete');
            
        } catch (error) {
            this.log(`⚠️ Could not set download path: ${error.message}`);
        }
    }

    async handleBravePopups() {
        try {
            this.log('🛡️ Checking for Brave popups...');
            
            // Check for various Brave popup selectors
            const popupSelectors = [
                '[role="dialog"]',
                '.notification',
                '.brave-notification',
                '.popup',
                '[data-test-id="notification"]'
            ];
            
            for (const selector of popupSelectors) {
                try {
                    const popup = await this.page.$(selector);
                    if (popup) {
                        this.log(`🎯 Found Brave popup: ${selector}`);
                        
                        // Try to find and click close button
                        const closeSelectors = [
                            'button[aria-label="Close"]',
                            'button[aria-label="Dismiss"]',
                            '.close-button',
                            'button:contains("×")',
                            'button:contains("Close")',
                            'button:contains("Dismiss")'
                        ];
                        
                        let closed = false;
                        for (const closeSelector of closeSelectors) {
                            try {
                                const closeButton = await popup.$(closeSelector);
                                if (closeButton) {
                                    await closeButton.click();
                                    this.log(`✅ Closed Brave popup with: ${closeSelector}`);
                                    closed = true;
                                    break;
                                }
                            } catch (closeError) {
                                // Continue to next close selector
                            }
                        }
                        
                        if (!closed) {
                            // Try pressing Escape key
                            await this.page.keyboard.press('Escape');
                            this.log('⌨️ Tried Escape key for popup');
                        }
                    }
                } catch (selectorError) {
                    // Continue to next popup selector
                }
            }
            
        } catch (error) {
            this.log(`⚠️ Error checking for Brave popups: ${error.message}`);
        }
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
            const downloadedWords = downloadedTitle.split(' ').filter(word => word.length > 2);
            const currentWords = normalizedTitle.split(' ').filter(word => word.length > 2);
            
            // Check if one title is a subset of another (for cases like "laws of power" vs "laws of power greene robert...")
            const shorterWords = downloadedWords.length < currentWords.length ? downloadedWords : currentWords;
            const longerWords = downloadedWords.length >= currentWords.length ? downloadedWords : currentWords;
            
            const commonWords = shorterWords.filter(word => longerWords.includes(word));
            const subsetSimilarity = commonWords.length / shorterWords.length;
            
            // If shorter title is 80% contained in longer title, it's likely the same book
            if (subsetSimilarity >= 0.8 && shorterWords.length >= 2) {
                this.log(`📖 Similar book found (subset match ${(subsetSimilarity*100).toFixed(1)}%): "${bookTitle}" ≈ "${downloadedTitle}"`);
                return true;
            }
            
            // Traditional fuzzy matching for similar length titles
            const allCurrentWords = currentWords.filter(word => word.length > 3);
            const matchingWords = allCurrentWords.filter(word => downloadedWords.includes(word));
            const traditionalSimilarity = matchingWords.length / Math.max(allCurrentWords.length, downloadedWords.filter(word => word.length > 3).length);
            
            if (traditionalSimilarity > 0.7) {
                this.log(`📖 Similar book found (fuzzy match ${(traditionalSimilarity*100).toFixed(1)}%): "${bookTitle}" ≈ "${downloadedTitle}"`);
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
                await this.randomDelay(200, 800);
                
                // Click with slight delay
                await this.page.mouse.click(x, y);
                await this.randomDelay(300, 800);
            } else {
                // Fallback to regular click
                await element.click();
                await this.randomDelay(500, 1500);
            }
            
            this.log(`✅ Clicked: ${description}`);
            
        } catch (error) {
            this.log(`❌ Failed to click ${description}: ${error.message}`);
            throw error;
        }
    }

    async navigateToWelib() {
        try {
            this.log('🔗 Navigating to welib.org...');
            await this.page.goto('https://welib.org/', { 
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            await this.randomDelay(5000, 10000);
            this.log('✅ Successfully loaded welib.org');
            return true;
        } catch (error) {
            this.log(`❌ Failed to navigate to welib.org: ${error.message}`);
            return false;
        }
    }

    async scrollAndFindBooks() {
        try {
            this.log('📜 Scrolling to discover more books...');
            
            // Scroll down gradually to load more content
            await this.page.evaluate(() => {
                window.scrollTo(0, window.innerHeight);
            });
            await this.randomDelay(2000, 4000);
            
            // Scroll down more
            await this.page.evaluate(() => {
                window.scrollTo(0, window.innerHeight * 1.5);
            });
            await this.randomDelay(3000, 5000);
            
            // Check for and click "Load More" button if present
            await this.loadMoreBooksIfNeeded();
            
            this.log('✅ Scrolling complete, books should be loaded');
            
        } catch (error) {
            this.log(`⚠️ Error during scrolling: ${error.message}`);
        }
    }

    async loadMoreBooksIfNeeded() {
        try {
            this.log('📚 Checking for "Load More" button...');
            const loadMoreButton = await this.page.$('#load-more-button');
            
            if (loadMoreButton) {
                this.log('🔽 Found "Load More" button - clicking to get more books');
                await this.humanLikeClick(loadMoreButton, 'Load More button');
                await this.randomDelay(5000, 8000);
                this.log('✅ More books should be loaded now');
                return true;
            } else {
                this.log('📋 No "Load More" button found');
                return false;
            }
        } catch (error) {
            this.log(`⚠️ Error loading more books: ${error.message}`);
        }
        return false;
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
            
            // Log first few book titles for debugging
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
            this.log(`📖 Clicking on book: ${bookElement.title.substring(0, 50)}...`);
            
            // Use the href to navigate directly
            await this.page.goto(bookElement.href, { waitUntil: 'networkidle2' });
            await this.randomDelay(3000, 6000);
            
            return true;
            
        } catch (error) {
            this.log(`❌ Error clicking book title: ${error.message}`);
            return false;
        }
    }

    async findAndClickDownloadButton() {
        try {
            this.log('🔽 Looking for download servers...');
            
            // Wait for download buttons to appear
            await this.page.waitForSelector('.js-download-link', { timeout: 15000 });
            
            const downloadButtons = await this.page.$$('.js-download-link');
            this.log(`🌐 Found ${downloadButtons.length} download servers`);
            
            if (downloadButtons.length === 0) {
                return { success: false, server: null };
            }
            
            // Try Server #2 first (index 1), then Server #1 (index 0)
            const serverPriority = downloadButtons.length > 1 ? [1, 0] : [0];
            
            for (const serverIndex of serverPriority) {
                if (serverIndex >= downloadButtons.length) continue;
                
                try {
                    this.log(`🌐 Trying Server #${serverIndex + 1}...`);
                    const downloadButton = downloadButtons[serverIndex];
                    
                    await this.humanLikeClick(downloadButton, `Server #${serverIndex + 1} download`);
                    await this.randomDelay(3000, 6000);
                    
                    return { success: true, server: serverIndex + 1 };
                    
                } catch (serverError) {
                    this.log(`❌ Server #${serverIndex + 1} failed: ${serverError.message}`);
                    if (serverIndex === serverPriority[serverPriority.length - 1]) {
                        throw serverError; // Last server failed
                    }
                }
            }
            
            return { success: false, server: null };
            
        } catch (error) {
            this.log(`❌ Error finding download button: ${error.message}`);
            return { success: false, server: null };
        }
    }

    async waitForCountdown() {
        try {
            this.log('⏰ Waiting for download countdown...');
            await this.randomDelay(3000, 6000);
            
            // First, check if there's a "Please wait" message
            const hasWaitMessage = await this.page.evaluate(() => {
                const text = document.body.innerText.toLowerCase();
                return text.includes('please wait') && text.includes('seconds');
            });
            
            if (!hasWaitMessage) {
                this.log('✅ No countdown detected - proceeding immediately');
                return true;
            }
            
            this.log('⏳ Found "Please wait" message, looking for countdown...');
            
            // Look for countdown elements using different selectors
            const countdownSelectors = [
                '.js-partner-countdown',
                '[data-countdown]',
                '.countdown',
                '.timer',
                '.wait-timer'
            ];
            
            let countdownElement = null;
            let usedSelector = null;
            
            for (const selector of countdownSelectors) {
                try {
                    countdownElement = await this.page.$(selector);
                    if (countdownElement) {
                        usedSelector = selector;
                        this.log(`📍 Found countdown element: ${selector}`);
                        break;
                    }
                } catch (selectorError) {
                    // Continue to next selector
                }
            }
            
            if (!countdownElement) {
                // Try to extract countdown from page text as fallback
                const countdownTime = await this.page.evaluate(() => {
                    const text = document.body.innerText;
                    const match = text.match(/please wait[^\d]*(\d+)[^\d]*seconds/i);
                    return match ? parseInt(match[1]) : null;
                });
                
                if (countdownTime) {
                    this.log(`⏳ Extracted countdown from text: ${countdownTime} seconds`);
                    this.log(`⏳ Download countdown: ${countdownTime} seconds`);
                    await this.randomDelay((countdownTime + 5) * 1000, (countdownTime + 15) * 1000);
                    this.log('✅ Countdown completed!');
                    return true;
                } else {
                    this.log('⚠️ Could not find countdown, waiting default time');
                    await this.randomDelay(300000, 320000); // 5+ minutes default
                    return true;
                }
            }
            
            // Monitor countdown element in real-time
            this.log(`⏳ Found countdown element (selector: ${usedSelector}), monitoring live countdown...`);
            
            let currentCountdown = null;
            let consecutiveZeros = 0;
            
            // Monitor the countdown element until it reaches 0
            while (true) {
                try {
                    // Get current countdown value from the live element
                    currentCountdown = await this.page.evaluate((selector) => {
                        const element = document.querySelector(selector);
                        if (element) {
                            const text = element.textContent;
                            const match = text.match(/(\d+)/);
                            return match ? parseInt(match[1]) : null;
                        }
                        return null;
                    }, usedSelector);
                    
                    if (currentCountdown === null) {
                        this.log('⚠️ Countdown element disappeared, checking for download link...');
                        break;
                    }
                    
                    if (currentCountdown === 0) {
                        consecutiveZeros++;
                        this.log(`⏳ Countdown reached 0 (${consecutiveZeros}/3 confirmations)`);
                        
                        // Wait for 3 consecutive zero readings to be sure
                        if (consecutiveZeros >= 3) {
                            this.log('✅ Countdown completed! (confirmed)');
                            break;
                        }
                    } else {
                        consecutiveZeros = 0; // Reset if not zero
                        
                        // Log every 30 seconds or when significant changes occur
                        if (currentCountdown % 30 === 0 || currentCountdown < 30) {
                            this.log(`⏳ Live countdown: ${currentCountdown} seconds remaining`);
                        }
                    }
                    
                    // Wait before checking again (longer intervals for higher numbers)
                    if (currentCountdown > 60) {
                        await this.randomDelay(10000, 15000); // Check every 10-15 seconds
                    } else if (currentCountdown > 10) {
                        await this.randomDelay(5000, 8000); // Check every 5-8 seconds
                    } else {
                        await this.randomDelay(2000, 3000); // Check every 2-3 seconds when close
                    }
                    
                } catch (monitorError) {
                    this.log(`⚠️ Error monitoring countdown: ${monitorError.message}`);
                    // Fallback: wait a bit and try again
                    await this.randomDelay(5000, 10000);
                }
            }
            
            this.log('✅ Countdown monitoring completed!');
            await this.randomDelay(3000, 8000);
            return true;
            
        } catch (error) {
            this.log(`❌ Error during countdown: ${error.message}`);
            // Fallback: wait default time
            await this.randomDelay(300000, 320000);
            return true;
        }
    }

    async findAndClickFinalDownload() {
        try {
            this.log('📥 Looking for final download link...');
            
            // Wait for page to update after countdown
            await this.randomDelay(3000, 6000);
            
            // Debug: Log current page URL and content
            const currentUrl = this.page.url();
            this.log(`🔍 Current page: ${currentUrl}`);
            
            // Check if we're on the right page after countdown
            const pageContent = await this.page.evaluate(() => {
                const text = document.body.innerText.toLowerCase();
                return {
                    hasDownloadText: text.includes('download'),
                    hasLibgenText: text.includes('libgen'),
                    hasFileText: text.includes('.pdf') || text.includes('.epub') || text.includes('.mobi'),
                    linkCount: document.querySelectorAll('a').length
                };
            });
            
            this.log(`📊 Page analysis: download=${pageContent.hasDownloadText}, libgen=${pageContent.hasLibgenText}, files=${pageContent.hasFileText}, links=${pageContent.linkCount}`);
            
            // Try multiple strategies to find the final download link
            const strategies = [
                // Strategy 1: Look for direct libgen download links
                async () => {
                    this.log('🔍 Strategy 1: Looking for libgen links...');
                    const directLinks = await this.page.$$('a[href*="libgen"]');
                    this.log(`   Found ${directLinks.length} libgen links`);
                    for (const link of directLinks) {
                        const href = await link.evaluate(el => el.href);
                        const text = await link.evaluate(el => el.textContent.trim());
                        this.log(`   Checking: "${text}" -> ${href.substring(0, 80)}...`);
                        if (href && (href.includes('.pdf') || href.includes('.epub') || href.includes('.mobi'))) {
                            return { element: link, url: href };
                        }
                    }
                    return null;
                },
                
                // Strategy 2: Look for any external download links
                async () => {
                    this.log('🔍 Strategy 2: Looking for external download links...');
                    const externalLinks = await this.page.$$('a[href^="http"]');
                    this.log(`   Found ${externalLinks.length} external links`);
                    for (const link of externalLinks) {
                        const href = await link.evaluate(el => el.href);
                        const text = await link.evaluate(el => el.textContent.trim());
                        this.log(`   Checking external link: "${text}" -> ${href.substring(0, 80)}...`);
                        if (href && !href.includes('welib.org')) {
                            // Any external link could be a download - let's be more permissive
                            if (href.includes('libgen') || href.includes('download') || 
                                href.includes('.pdf') || href.includes('.epub') || href.includes('.mobi') ||
                                href.length > 50) { // Reasonable download URL length
                                this.log(`   ✅ Found candidate: "${text}" -> ${href.substring(0, 80)}...`);
                                return { element: link, url: href };
                            }
                        }
                    }
                    return null;
                },
                
                // Strategy 3: Look for download buttons/links (fixed selector)
                async () => {
                    this.log('🔍 Strategy 3: Looking for download buttons...');
                    const downloadLinks = await this.page.$$('a[href*="download"], .download-link, .js-download-link');
                    this.log(`   Found ${downloadLinks.length} download elements`);
                    
                    // Also look for buttons and links containing "download" text
                    const downloadTextElements = await this.page.evaluate(() => {
                        const elements = [];
                        const allLinks = document.querySelectorAll('a, button');
                        for (const el of allLinks) {
                            const text = el.textContent.toLowerCase();
                            if (text.includes('download')) {
                                elements.push({
                                    href: el.href || '',
                                    text: el.textContent.trim(),
                                    tagName: el.tagName
                                });
                            }
                        }
                        return elements;
                    });
                    
                    this.log(`   Found ${downloadTextElements.length} elements with "download" text`);
                    for (const element of downloadTextElements) {
                        this.log(`   Checking: "${element.text}" -> ${element.href.substring(0, 80)}...`);
                        if (element.href && (element.href.includes('libgen') || element.href.includes('download') || element.href.length > 50)) {
                            // Find the actual DOM element to click
                            const domElement = await this.page.evaluateHandle((text) => {
                                const allElements = document.querySelectorAll('a, button');
                                for (const el of allElements) {
                                    if (el.textContent.trim() === text) {
                                        return el;
                                    }
                                }
                                return null;
                            }, element.text);
                            
                            if (domElement && domElement.asElement()) {
                                this.log(`   ✅ Found download element: "${element.text}"`);
                                return { element: domElement.asElement(), url: element.href };
                            }
                        }
                    }
                    return null;
                },
                
                // Strategy 4: Look for any clickable element that might be a download
                async () => {
                    this.log('🔍 Strategy 4: Looking for clickable download elements...');
                    const clickableElements = await this.page.$$('[onclick*="download"], [onclick*="libgen"], [data-href], [data-url]');
                    this.log(`   Found ${clickableElements.length} clickable elements`);
                    for (const element of clickableElements) {
                        const onclick = await element.evaluate(el => el.onclick?.toString() || el.getAttribute('data-href') || el.getAttribute('data-url') || '');
                        const text = await element.evaluate(el => el.textContent.trim());
                        if (onclick && (onclick.includes('libgen') || onclick.includes('download'))) {
                            this.log(`   Found candidate: "${text}" -> ${onclick.substring(0, 80)}...`);
                            // Try to extract URL from onclick or data attributes
                            const urlMatch = onclick.match(/https?:\/\/[^\s"']+/);
                            if (urlMatch) {
                                return { element: element, url: urlMatch[0] };
                            }
                        }
                    }
                    return null;
                }
            ];
            
            let downloadInfo = null;
            for (let i = 0; i < strategies.length; i++) {
                try {
                    downloadInfo = await strategies[i]();
                    if (downloadInfo) {
                        this.log(`🎯 Found download link: ${downloadInfo.url.substring(0, 80)}...`);
                        break;
                    }
                } catch (strategyError) {
                    this.log(`⚠️ Strategy ${i + 1} failed: ${strategyError.message}`);
                }
            }
            
            if (!downloadInfo) {
                this.log('❌ Could not find final download link');
                return { success: false, url: null };
            }
            
            // Try to set download path (may not work due to security)
            try {
                const client = await this.page.target().createCDPSession();
                await client.send('Page.setDownloadBehavior', {
                    behavior: 'allow',
                    downloadPath: this.downloadDir
                });
                this.log('💾 Set download directory successfully');
            } catch (pathError) {
                this.log('⚠️ Could not set download path, will handle dialog manually');
            }
            
            // Click the download link (this will trigger browser download)
            await this.humanLikeClick(downloadInfo.element, 'final download link');
            
            // Handle macOS download dialog
            this.log('⏳ Waiting for download dialog...');
            await this.randomDelay(3000, 6000);
            await this.handleMacDownloadDialog();
            
            // Wait a bit more for download to start
            await this.randomDelay(5000, 8000);
            
            return { success: true, url: downloadInfo.url };
            
        } catch (error) {
            this.log(`❌ Error finding final download: ${error.message}`);
            return { success: false, url: null };
        }
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
            const filename = `${cleanTitle.replace(/\s+/g, ' ')}_${timestamp}${extension}`;
            const filePath = path.join(this.downloadDir, filename);
            
            this.log(`💾 Saving to: ${filename}`);
            
            // Download file using axios
            const axios = require('axios');
            const response = await axios({
                method: 'GET',
                url: downloadUrl,
                responseType: 'stream',
                timeout: 300000, // 5 minutes timeout
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            // Create write stream
            const writer = fs.createWriteStream(filePath);
            
            // Pipe response to file
            response.data.pipe(writer);
            
            return new Promise((resolve, reject) => {
                writer.on('finish', async () => {
                    try {
                        const stats = await fs.stat(filePath);
                        const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
                        this.log(`✅ Downloaded successfully: ${filename} (${fileSizeMB} MB)`);
                        resolve(filePath);
                    } catch (statError) {
                        this.log(`⚠️ Download completed but could not get file stats: ${statError.message}`);
                        resolve(filePath);
                    }
                });
                
                writer.on('error', async (error) => {
                    this.log(`❌ Download write error: ${error.message}`);
                    try {
                        await fs.unlink(filePath); // Clean up partial file
                    } catch (unlinkError) {
                        // Ignore cleanup errors
                    }
                    reject(error);
                });
                
                response.data.on('error', async (error) => {
                    this.log(`❌ Download stream error: ${error.message}`);
                    try {
                        await fs.unlink(filePath); // Clean up partial file
                    } catch (unlinkError) {
                        // Ignore cleanup errors
                    }
                    reject(error);
                });
            });
            
        } catch (error) {
            this.log(`❌ Download failed: ${error.message}`);
            return null;
        }
    }

    async handleMacDownloadDialog() {
        try {
            this.log('🍎 Attempting to handle macOS download dialog...');
            await this.randomDelay(2000, 5000);
            
            // Try multiple keyboard shortcuts that might work
            const shortcuts = [
                async () => {
                    this.log('⌨️ Trying Enter key...');
                    await this.page.keyboard.press('Enter');
                },
                async () => {
                    this.log('⌨️ Trying NumpadEnter key...');
                    await this.page.keyboard.press('NumpadEnter');
                },
                async () => {
                    this.log('⌨️ Trying Cmd+S...');
                    await this.page.keyboard.down('Meta');
                    await this.page.keyboard.press('KeyS');
                    await this.page.keyboard.up('Meta');
                },
                async () => {
                    this.log('⌨️ Trying Space bar...');
                    await this.page.keyboard.press('Space');
                },
                async () => {
                    this.log('⌨️ Trying Tab + Enter...');
                    await this.page.keyboard.press('Tab');
                    await this.page.keyboard.press('Enter');
                }
            ];
            
            for (const shortcut of shortcuts) {
                try {
                    await shortcut();
                    await this.randomDelay(1000, 2000);
                } catch (shortcutError) {
                    // Continue to next shortcut
                }
            }
            
            this.log('✅ Attempted all download dialog shortcuts');
            await this.randomDelay(5000, 8000);
            
        } catch (error) {
            this.log(`⚠️ Error handling download dialog: ${error.message}`);
        }
    }

    async scrapeMultipleBooks(maxBooks = 40) {
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
                }
            }
            
            this.log(`🎉 Scraping completed: ${results.length}/${maxBooks} books downloaded`);
            return results;
            
        } catch (error) {
            this.log(`❌ Error during multiple book scrape: ${error.message}`);
            return [];
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
            
            // Step 5: Click final download and ensure file is actually downloaded
            const finalDownload = await this.findAndClickFinalDownload();
            if (finalDownload.success) {
                // First try browser download, then fallback to manual download
                this.log('⏳ Waiting for browser download to complete...');
                await this.randomDelay(10000, 15000); // Wait for browser download
                
                // Check if file was actually downloaded by browser
                const files = await fs.readdir(this.downloadDir);
                const recentFiles = [];
                const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
                
                for (const file of files) {
                    try {
                        const filePath = path.join(this.downloadDir, file);
                        const stats = await fs.stat(filePath);
                        if (stats.mtime.getTime() > fiveMinutesAgo) {
                            recentFiles.push(file);
                        }
                    } catch (e) {
                        // Skip files we can't stat
                    }
                }
                
                let downloadedFile = null;
                
                if (recentFiles.length > 0) {
                    // Browser download worked
                    downloadedFile = recentFiles[recentFiles.length - 1]; // Get most recent
                    this.log(`✅ Browser download successful: ${downloadedFile}`);
                } else {
                    // Browser download failed, try manual download as fallback
                    this.log('⚠️ Browser download failed, trying manual download...');
                    downloadedFile = await this.downloadFileToFolder(finalDownload.url, selectedBook.title);
                }
                
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
                    this.log('❌ Both browser and manual download failed');
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
        try {
            fs.appendFileSync(this.logFile, logMessage + '\n');
        } catch (logError) {
            // Ignore log file errors
        }
    }
}

// Main execution function
async function main() {
    console.log('🎯 WELIB.ORG AUTOMATED SCRAPER');
    console.log('==============================');
    console.log('Using captured selectors from manual inspection\n');
    
    const scraper = new WelibScraper();
    let results = [];
    
    try {
        await scraper.init();
        
        // Run sequential mode (2 books)
        results = await scraper.scrapeMultipleBooks(40);
        
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