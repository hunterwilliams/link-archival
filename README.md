# Mass Link Archival Tool

This allows for logging a large number of links spread throughout text files to be snapshotted in order for archivial.


## How to Use

  1. Place the files you want to go through in ./docs (the existing ones are demo)
    * Please note links should start with http:// or https://
  2. run `npm run start` 
    * If you have a beefy computer you can up the worker count by adding a number afterwards ``npm run start 4``. The default is 2.
  3. The output will go into ./output will be categorized into folders by the original filename and then labelled with the santitized link as their filename.
    * EG You have a file called group1.md with a link to https://google.com; Your output will be a folder called group1 with a file called google_com.png

# License

Please see [license](license.md)

# Note

* Please note by using this software you may be breaking the terms and conditions of whatever site you point it at. Use wisely