"use strict";

const path = require("path"),
      expect = require("expect.js"),
      fetch = require("node-fetch"),
      FormData = require("form-data"),
      fs = require("fs-extra"),
      imageDiff = require("image-diff"),
      lightOrm = require("light-orm"),
      mysql = require("mysql"),
      should = require("should");

module.exports = class {
  /**
   * Use `not` in db[].result.data to assert if values differ
   * @return {object} Restament's `not` object
   */
  static not() {
    const args = [];

    for (const argument of arguments) {
      args.push(argument);
    }

    return {
      type:   "not",
      values: args
    };
  }

  /**
   * Constructor for Restament
   *
   * @param {object} opts             Options
   * @param {string} opts.endpoint    API Endpoint
   * @param {string} opts.db.host     Database host name
   * @param {string} opts.db.name     Database name
   * @param {string} opts.db.user     Database user name
   * @param {string} opts.db.password Database password
   */
  constructor(opts) {
    this.config = opts;

    // Option assertion
    if (typeof opts !== "object"
        || !opts.endpoint
    ) {
      throw new Error("Missing option value `endpoint`");
    }

    this.endpoint = opts.endpoint;
    this.uploadDir = opts && opts.uploadDir ? opts.uploadDir : null;
    this.logDir = opts && opts.logDir ? opts.logDir : null;

    // DB configuration
    if (typeof this.config.db === "object"
        && this.config.db.host
        && this.config.db.name
        && this.config.db.user
        && this.config.db.password
    ) {
      lightOrm.driver = mysql.createConnection({
        host:     this.config.db.host,
        database: this.config.db.name,
        user:     this.config.db.user,
        password: this.config.db.password
      });
      lightOrm.driver.connect();
    }
  }

  test(tests) {
    const self = this;

    if (!Array.isArray(tests) || typeof tests !== "object" || tests.length <= 0) {
      throw new Error("Test object has to be object or array of objects!");
    }

    if (!Array.isArray(tests)) {
      tests = [tests];
    }

    for (const test of tests) {
      const uri = self.endpoint + test.url;

      describe(test.url, function() {
        this.timeout(5000);

        let postData;

        //
        // Prepare data to post/put
        //
        if (test.reqformat === "FORM") {
          postData = new FormData();

          for (const key of Object.keys(test.reqdata)) {
            // Workaround: Node.js's form-data doesn't support array as form value, unlike browser implementation.
            // You need to join with comma instead.
            postData.append(key, Array.isArray(test.reqdata[key]) ? test.reqdata[key].join(",") : test.reqdata[key]);
          }

          if ((test.method === "POST" || test.method === "PUT") && test.uploads) {
            for (const key of Object.keys(test.uploads)) { // Uploading file(s)
              postData.append(key, fs.createReadStream(test.uploads[key]));
            }
          }
        } else { // if test.reqformat === "JSON" or unspecified
          if (test.uploads) { // When upload file is specified, you need to send as form data
            return Promise.reject(new Error("Cannot upload files with data in JSON format"));
          }

          postData = JSON.stringify(test.reqdata);
        }

        it("should return " + test.status + " on " + test.method + " access (posting in " + test.reqformat + " format)", function() {
          const dbtables = (Array.isArray(test.db) ? test.db : [test.db]).map(function(table) {
            table.table = new lightOrm.Collection(table.tablename);
            return table;
          });

          return new Promise(function(resolve, reject) {
            // Empty storage directory
            fs.emptyDirSync(self.uploadDir);

            // Remove existing records
            Promise.all(dbtables.map(function(dbtable) {
              return new Promise(function(resolve, reject) {
                dbtable.table.findAll(function(err, existingRecords) {
                  if (err) {
                    reject(err);
                  }

                  Promise.all(existingRecords.map(function(existingRecord) {
                    return new Promise(function(resolve, reject) {
                      existingRecord.remove(function(err) {
                        if (err) {
                          reject(err);
                        }
                        resolve();
                      });
                    });
                  })).then(resolve).catch(reject);
                });
              });
            })).then(resolve).catch(reject);
          }).then(function() {
            return Promise.all(dbtables.map(function(table) {
              let models = []; // eslint-disable-line prefer-const

              //
              // Setup mock data
              //
              if (!table.mock) {
                return Promise.resolve();
              }

              if (!Array.isArray(table.mock.data)) {
                table.mock.data = [table.mock.data];
              }

              for (const d of table.mock.data) {
                models.push(table.table.createModel(d));
              }

              // Create records
              return Promise.all(models.map(function(model) {
                return new Promise(function(resolve, reject) {
                  model.create(function(err) {
                    if (err) {
                      reject(err);
                    }
                    resolve();
                  });
                });
              }));
            }));
          }).then(function() {
            return Promise.all(dbtables.map(function(table) {
              if (!(table.mock && table.mock.uploads)) {
                return Promise.resolve();
              }

              return Promise.all(table.mock.uploads.map(function(upload) {
                return new Promise(function(resolve, reject) {
                  // Upload resources
                  fs.copy(upload.src, path.join(self.uploadDir, upload.dest), function(err) {
                    if (err) {
                      reject(err);
                    }
                    resolve();
                  });
                });
              }));
            }));
            // End of Mockup Data generation
          }).then(function() {
            //
            // Before
            //
            if (typeof test.before === "function") {
              return test.before();
            }
            return Promise.resolve();
          }).then(function() {
            //
            // Testing REST API
            //
            let contentType;

            if (test.reqformat === "JSON") {
              contentType = "application/json";
            } else if (test.reqformat === "FORM") {
              if (test.uploads) {
                contentType = "multipart/form-data";
              } else {
                contentType = "application/x-www-form-urlencoded";
              }
            }

            return fetch(uri, {
              method: test.method,
              body:   test.method !== "GET" ? postData : null,
              header: {
                "Content-Type": contentType
              }
            });
          }).then(function(res) { // Assertion for response
            expect(res.status).to.be(test.status);
            return res.text();
          }).then(function(body) {
            try {
              const json = JSON.parse(body);

              json.should.be.eql(test.resdata); // Use should.js for object comparison

              return Promise.all(dbtables.map(function(table) {
                // Check if data in DB is as expected
                return new Promise(function(resolve, reject) {
                  if (!table.result || !table.result.data) {
                    resolve();
                    return;
                  }

                  table.table.findAll(function(err, _records) {
                    if (err) {
                      reject(err);
                    }

                    const records = _records.map(function(record) {
                      return record.getAll();
                    }).sort(function(record1, record2) {
                      return record1.id - record2.id;
                    });

                    if (!Array.isArray(table.result.data)) {
                      table.result.data = [table.result.data];
                    }

                    for (let i = 0; i < records.length; i++) {
                      for (const key of Object.getOwnPropertyNames(table.result.data[i])) {
                        const expectedColumnData = table.result.data[i][key],
                              actualColumnData = records[i][key];

                        if (typeof expectedColumnData === "object" && expectedColumnData.type === "not") { // If Restament.not is expected
                          expect(expectedColumnData).not.to.be(actualColumnData);
                        } else if (typeof expectedColumnData === "function") {
                          expect(expectedColumnData(actualColumnData)).to.be(true);
                        } else { // expectedColumnData is literal
                          // Check equality
                          expect(actualColumnData).to.be(table.result.data[i]);
                        }
                      }
                    }

                    resolve();
                  });
                }).then(function() {
                  return new Promise(function(resolve, reject) {
                    if (!table.result || !table.result.uploads) {
                      resolve();
                      return;
                    }

                    table.result.uploads.forEach(function(upload) {
                      const uploadedFileName = path.join(self.uploadDir, upload.filename);

                      imageDiff({
                        actualImage:   uploadedFileName,
                        expectedImage: upload.original,
                        diffImage:     path.join(self.logDir, "images/diff")
                      }, function(err, imagesAreSame) {
                        if (err) {
                          reject(err);
                        }

                        // Save image if images doesn't match
                        if (!imagesAreSame) {
                          const resultDir = path.join(__dirname, "../tmp/images");

                          if (fs.existsSync(uploadedFileName)) {
                            fs.copySync(uploadedFileName, path.join(resultDir, "uploaded"));
                          } else {
                            reject(new Error(uploadedFileName + " doesn't exist!"));
                          }

                          if (fs.existsSync(upload.original)) {
                            fs.copySync(upload.original, path.join(resultDir, "expected"));
                          } else {
                            reject(new Error(upload.original + " doesn't exist!"));
                          }
                        }

                        expect(imagesAreSame).to.be(true);
                        resolve();
                      });
                    });
                  });
                });
              }));
            } catch (e) {
              if (e instanceof SyntaxError) {
                return Promise.reject(
                  "Response body is not JSON! Response body is:\n"
                  + "--------------------\n"
                  + body + "\n"
                  + "--------------------\n"
                );
              }
            }
          }).then(function() {
            if (typeof test.after === "function") {
              return test.after();
            } else {
              return Promise.resolve();
            }
          }).catch(function(err) {
            should.ifError(err);
            return Promise.reject(err);
          });
        });
      });
    }
  }
};
