const fs = require('fs'),
    es = require('event-stream'),
    os = require('os');
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


async function scrape(link, storagePath) {

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const fileStorageName = storagePath + link.replace("http://", "").replace("https://","").replace("/","_");

  console.log("Puppeteer about to snapshot: " + link);
  await page.goto(link);
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
    case "screen-all":
      console.log("Getting map of links from each file");
      const mapOfLinks = getLinksFromMdFilesInDirectory('./docs/');
      console.log("Map of links assembled");

      const outputPath = './output/';
      makeDirIfMissing(outputPath);
      console.log("Ensured parent output directory exists");
      const totalItemsCount = Object.keys(mapOfLinks).length;
      let totalFinishedCount = 0;

      for (const item in mapOfLinks) {
        const storagePath = outputPath + item.replace("\.md", "") + "\/";
        makeDirIfMissing(storagePath);

        const promises = [];
        console.log("About to start storing items related to " + item);
        for (let i = 0; i < mapOfLinks[item].length; i += 1) {
          const link = mapOfLinks[item][i];
          console.log(link);
          promises.push(scrape(link, storagePath));
        }
        Promise.all(promises).then(() => {
          totalFinishedCount += 1;
          console.log("Finished storing items related to " + item);

          console.log(`Finished file ${totalFinishedCount} of ${totalItemsCount}`);
          if (totalFinishedCount === totalItemsCount) {
            console.log("!All done!");
            process.exit(1);
          }
        }).catch((reason) => {
          console.warn("Some issue: " + reason);
        });
      }
      break;
    default:
      console.log(`Command ${command} not found`);
      break;
  }
}