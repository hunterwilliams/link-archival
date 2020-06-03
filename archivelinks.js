const fs = require('fs'),
    http = require('http'),
    https = require('https'),
    es = require('event-stream'),
    os = require('os');
const { fork } = require('child_process');
const puppeteer = require('puppeteer');

// returns an array of URLS based on a file with links
function getLinksFromFile(file) {
  const text = fs.readFileSync(file,'utf8');
  const linksInMdFiles = /\[.*\]\((.*)\)|\<(.*)\>|(http[s]?:\/\/[^\s]*)/gm;
  const matches = text.matchAll(linksInMdFiles);
  
  const links = [];
  for (const match of matches) {
    const stringMatched = match[2] || match[1] || match[0];
    links.push(stringMatched);
  }
  return links;
}

function getFilesFromDirectory(parentPath, fileExtension) {
  const folderContents = fs.readdirSync(parentPath);
  if (!fileExtension || fileExtension === "*") {
    return folderContents;
  }
  return folderContents.filter((value) => value.endsWith(fileExtension));
}

function getLinksFromMdFilesInDirectory(path) {
  const files = getFilesFromDirectory(path, ".md");
  const map = {};
  for (let i = 0; i < files.length; i += 1) {
    const filename = files[i];
    map[filename] = getLinksFromFile(path + filename);
  }
  return map;
}

function makeDirIfMissing(path) {
  if (!fs.existsSync(path)){
    fs.mkdirSync(path);
  }
}

function download(url, dest, cb) {
  const file = fs.createWriteStream(dest);
  const network = url.startsWith('https') ? https : http;
  network.get(url, function(response) {
    response.pipe(file);
    file.on('finish', function() {
      file.close(cb);
    });
  }).on('error', function(err) {
    fs.unlink(dest);
    if (cb) cb(err.message);
  });
};

async function handleJobs(threadName) {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-notifications']
  });
  process.on("message", (msg) => {
    if (msg === "off") {
      console.log(`Thread ${threadName} good night`);
      process.exit(0);
    } else if (msg.link && msg.storagePath) {
      scrape(browser, msg.link, msg.storagePath, threadName).then(() => {
        process.send("next");
      }).catch((reason) => {
        console.warn(reason);
        process.send("error")
      });
    }
  });
  return true;
}


const unsafeCharacterRegex = new RegExp("[^0-9a-zA-Z-._]", 'g');
async function scrape(browser, link, storagePath, threadName) {

  const page = await browser.newPage();
  const fileStorageName = storagePath + link.replace("http://", "").replace("https://","").replace(unsafeCharacterRegex,"_");

  console.log(`Thread ${threadName}: Puppeteer about to snapshot: ${link}`);
  await page.goto(link);

  if (link.indexOf("reddit.com") !== -1) {
    await page.waitForSelector('.Post');
    let rawVideoUrl = "";
    try {
      const videoMetaTag = await page.waitForSelector('meta[property="og:video"]');
      const videoMetaContent = await videoMetaTag.getProperty('content');
      rawVideoUrl = await videoMetaContent.jsonValue();
    } catch (e) {
      // no video
      console.log(e);
      console.log('no video');
    }
    if (rawVideoUrl) {
      rawVideoUrl = rawVideoUrl.replace("https://v.redd.it/","");
      const videoId = rawVideoUrl.substr(0, rawVideoUrl.indexOf("/"));
      const redditVideoDownloadUrl = `https://v.redd.it/${videoId}/DASH_720?source=fallback`;
      console.log(`Downloading video ${videoId} from Reddit`);
      download(redditVideoDownloadUrl, fileStorageName + ".mp4");
    }
  }
  else if (link.indexOf("twitter.com") !== -1) {
    const tweetId = link.substr(link.lastIndexOf("/") + 1);
    const expectedTweetAPIUrl = `https://api.twitter.com/2/timeline/conversation/${tweetId}.json`;
    const tweetResponse = await page.waitForResponse(request => {
      return  request.url().indexOf(expectedTweetAPIUrl) === 0;
    });
    await page.waitForSelector('[data-testid="tweet"]');

    try {
      const tweetData = await tweetResponse.json();
      console.log(`${link} has tweet data`);
      const twitterMedia = tweetData.globalObjects.tweets[tweetId].extended_entities.media;
      for (let i = 0; i < twitterMedia.length; i += 1) {
        if (twitterMedia[i].type === "photo") {
          console.log("Downloading photo... ", twitterMedia[i].media_url_https);
          download(twitterMedia[i].media_url_https, fileStorageName + i + ".jpg");
        } else if (twitterMedia[i].type === "video"){
          const videoVariants = twitterMedia[i].video_info.variants;
          if (videoVariants.length > 0) {
            const highestResolutionVideoFile = videoVariants.sort((a,b) => b.bitrate - a.bitrate)[0].url;
            console.log("Downloading video... ", highestResolutionVideoFile);
            download(highestResolutionVideoFile, fileStorageName + ".mp4");
          }
        }
      }
    } catch(err) {
      console.log(err);
    }
    
    /* skip over replies hidden popup if it's there */
    await page.waitForXPath('//span[contains(text(), "OK")]/ancestor-or-self::div[@role="button"]', {timeout: 200})
      .then((element) => {
        element.click()
      })
      .catch(() => {});
    await page.waitForXPath('//span[contains(text(), "OK")]/ancestor-or-self::div[@role="button"]', {hidden: true})
      .catch(() => {});
  }
  await page.screenshot({path: fileStorageName + ".png"});
  return true;
}


if (process.argv.length < 3) {
  console.log('Usage: node archivelinks.js [command]');
  process.exit(1);
} else {
  const command = process.argv[2];
  switch (command) {
    case "link-test":
      console.log(getLinksFromFile('./docs/file 1.md')); 
      break;
    case "folder-test":
      console.log(getFilesFromDirectory('./docs/'));
      break;
    case "links-folder":
      console.log(getLinksFromMdFilesInDirectory('./docs/'));
      break;
    case "take-jobs":
      const threadName = process.argv[3] || "";
      handleJobs(threadName).then(
        () => {
          process.send("ready");
        }
      ).catch(
        (reason) => console.warn(`some issue with thread ${threadName}.. `, reason)
      );
      break;
    case "screen-all":
      const maxWorkers = process.argv[3] || 2;
      console.log("Getting map of links from each file");
      const mapOfLinks = getLinksFromMdFilesInDirectory('./docs/');
      console.log("Map of links assembled");

      const outputPath = './output/';
      makeDirIfMissing(outputPath);
      console.log("Ensured parent output directory exists");
      const jobs = [];
      for (const item in mapOfLinks) {
        const storagePath = outputPath + item.replace("\.md", "") + "\/";
        makeDirIfMissing(storagePath);

        const promises = [];
        console.log("About to start storing items related to " + item);
        for (let i = 0; i < mapOfLinks[item].length; i += 1) {
          const link = mapOfLinks[item][i];
          console.log(link);
          jobs.push({link, storagePath});
        }
      }
      const totalLinks = jobs.length;
      let totalCompleted = 0;
      let totalErrors = 0;
      console.log("Total links to handle: " + totalLinks);
      console.log(`Initializing workers (${maxWorkers})`);
      let remainingWorkers = 0;
      for (let i = 0; i < maxWorkers; i +=1 ) {
        const forked = fork('archivelinks.js' , ["take-jobs", i]);
        forked.on('message', (msg) => {
          if (msg === "next" || msg === "ready" || msg === "error") {
            if (msg === "ready") {
              remainingWorkers += 1;
            }
            if (msg == "error") {
              totalErrors += 1;
            }
            if (msg === "next" || msg === "error") {
              totalCompleted += 1;
              console.log(`Completed ${totalCompleted} of ${totalLinks}; Total Errors: ${totalErrors}`);
            }
            if (jobs.length > 0) {
              forked.send(jobs.pop());
            } else {
              forked.send("off");
              remainingWorkers -= 1;
              if (remainingWorkers === 0) {
                console.log(`Finished ${totalLinks} Links; Total Errors: ${totalErrors}`);
                process.exit(0);
              }
            }
          }
        });
      }
      break;
    default:
      console.log(`Command ${command} not found`);
      break;
  }
}