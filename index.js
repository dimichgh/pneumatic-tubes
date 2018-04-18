const axios = require('axios')
const ChangesStream = require('changes-stream');
const eos = require('end-of-stream')
const exec = require('child_process').exec
const fs = require('fs')
const mkdirp = require('mkdirp')
const path = require('path')
const uuid = require('uuid')
const dbURL = 'http://source-repo:5984/registry';
const targetDb = ' http://taret-repo:5984/registry';

class Tubes {
  constructor (opts) {
    this.tmpFolder = './tmp/tarballs'
    mkdirp.sync('./tmp/tarballs')
  }
  series () {
    const changes = new ChangesStream({
      db: dbURL, // full database URL
      include_docs: true, // whether or not we want to return the full document as a property,
      since: 0
    })
    changes.on('readable', async () => {
      const change = changes.read()
      console.info(`processing sequence ${change.seq}`)
      if (change.doc && change.doc.versions) {
        changes.pause()
        try {
          await this.processChange(change)
        } catch (err) {
          console.warn(err)
        }
        changes.resume()
      }
    })
  }
  async processChange (change) {
      const load = async (version, retries) => {
          const tarball = `${dbURL}/${version.name}/${version.name}-${version.version}.tgz`;
          try {
            return await this.download(tarball, version)
          } catch (err) {
              if (retries-- > 0) {
                  console.warn(err.message, `loading ${version.name}@${version.version}, retries left ${retries}`);
                  return load(version, retries);
              }
              console.warn(err.message, `loading ${version.name}@${version.version}`)
          }
      }

    const versions = Object.keys(change.doc.versions)
    for (var i = 0, version; (version = change.doc.versions[versions[i]]) !== undefined; i++) {
      if (version.dist && version.dist.tarball) {
        try {
          const filename = await load(version, 3)
          if (!filename) {
              console.warn(`failed to load ${version.name}@${version.version}`);
              continue;
          }
          const isPublished = await this.isPublished(version);
          if (isPublished) {
              console.log(`${version.name}@${version.version} is already published`);
              continue;
          }
          await this.publish(filename)
        } catch (err) {
          console.warn(err.message, `loading ${version.name}@${version.version}`)
        }
      }
    }
  }
  isPublished(version) {
      const url = `${targetDb}/${version.name}`;
      return axios({
        method: 'get',
        url,
        timeout: 10000
      })
      .then(function(response) {
          if (response.status !== 200) {
              return false;
          }
          const info = response.data;
          return info.versions[version.version] !== undefined;
      })
  }
  download (tarball, version) {
    const filename = path.resolve(this.tmpFolder, `${version.name}@${version.version}.tgz`)
    if (fs.existsSync(filename)) {
        return Promise.resolve(filename);
    }
    return axios({
      method: 'get',
      url: tarball,
      responseType: 'stream',
      timeout: 10000
    })
    .then(function(response) {
      return new Promise((resolve, reject) => {
        const stream = response.data.pipe(fs.createWriteStream(filename))
        eos(stream, err => {
          if (err) return reject(err)
          else return resolve()
        })
      })
    })
    .then(() => {
      console.info(`finished writing ${version.name}@${version.version}, file:${filename}`)
      return filename
    })
  }
  publish (filename) {
    return new Promise((resolve, reject) => {
        return resolve();

      exec(`npm --registry ${targetDb} publish ${filename}`, {
        cwd: this.tmpFolder,
        env: process.env
      }, (err, stdout, stderr) => {
        if (err) return reject(err)
        else {
          console.info(`published ${stdout.trim()}`)
          return resolve()
        }
      })
    })
  }
}

module.exports = function (opts) {
  return new Tubes(opts)
}

const tubes = module.exports()
tubes.series()
