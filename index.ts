"use strict";

import * as assert from "assert";
import * as Bookshelf from "bookshelf";
import * as FormData from "form-data";
import * as fs from "fs-extra";
import * as imageDiff from "image-diff";
import * as isPromise from "is-promise";
import * as knex from "knex";
import * as fetch from "node-fetch";
import * as path from "path";

const enum HttpMethod {
  GET,
  POST,
  PUT,
  PATCH,
  DELETE,
  HEAD,
  OPTIONS,
  CONNECT,
}

const enum RequestFormat {
  Form,
  JSON,
}

export class Restament {
  /**
   * Use `not` in db[].result.data to assert if values differ
   * @return {object} Restament's `not` object
   */
  public static not() {
    const args = [];

    for (const argument of arguments) {
      args.push(argument);
    }

    return {
      type:   "not",
      values: args,
    };
  }

  /** Bookshelf instance */
  private bookshelf: Bookshelf;

  /**
   * Constructor for Restament
   *
   * @param {object} config             Options
   * @param {string} config.endpoint    API Endpoint
   * @param {string} config.db.host     Database host name
   * @param {string} config.db.name     Database name
   * @param {string} config.db.user     Database user name
   * @param {string} config.db.password Database password
   * @param {string} config.uploadDir   Directory to store mock uploaded files
   * @param {string} config.logDir      Directory to store logs
   */
  constructor(private config) {
    // Option assertion
    if (typeof config !== "object"
        || !config.endpoint
    ) {
      throw new Error("Missing option value `endpoint`");
    }

    // DB configuration
    if (typeof this.config.db === "object"
        && this.config.db.host
        && this.config.db.name
        && this.config.db.user
        && this.config.db.password
    ) {
      this.bookshelf = Bookshelf(knex({
        client:     "mysql",
        connection: {
          charset:  "utf8",
          database: this.config.db.name,
          host:     this.config.db.host,
          password: this.config.db.password,
          user:     this.config.db.user,
        },
      }));
    }
  }

  public async test(tests) {
    const self = this;

    if (!Array.isArray(tests)) {
      tests = [tests];
    }

    for (const test of tests) {
      if (typeof tests !== "object" || tests.length <= 0) {
        throw new Error("Test object has to be object or array of objects!");
      }

      if (!Array.isArray(test.db)) {
        test.db = [test.db];
      }

      const title = test.url + "should return " + test.status + " on " + test.method + " access (posting in " + test.reqformat + " format)",
            dbtables = test.db.map((table) => {
              table.table = self.bookshelf.Model.extend({
                tableName: table.tablename,
              });

              return table;
            }),
            models = dbtables.map((dbtable) => {
              return dbtable.table;
            });

      // If there is mock.uploads in table, uploadDir and logDir must be specified
      if (!self.config.uploadDir || !self.config.logDir) {
        for (const dbtable of dbtables) {
          if (dbtable.mock.uploads) {
            throw new Error("uploadDir and logDir must be specified in constructor when test includes mock.uploads");
          }
        }
      }

      await self.cleanup(models);

      if (typeof test.before === "function") {
        const beforeResult = test.before();

        if (isPromise(beforeResult)) {
          await beforeResult;
        }
      }

      await self.createMock(dbtables);

      let method,
          reqBody,
          reqformat;

      switch (test.reqformat) {
        case "FORM":
          reqformat = RequestFormat.Form;
          break;
        case "JSON":
          reqformat = RequestFormat.JSON;
          break;
        default:
          throw new Error("reqformat only supports FORM and JSON; '" + test.reqformat + "'is not supported");
      }

      switch (test.method) {
        case "GET":
          method = HttpMethod.GET;
          break;
        case "POST":
          method = HttpMethod.POST;
          break;
        case "PUT":
          method = HttpMethod.PUT;
          break;
        case "PATCH":
          method = HttpMethod.PATCH;
          break;
        case "DELETE":
          method = HttpMethod.DELETE;
          break;
        case "HEAD":
          method = HttpMethod.HEAD;
          break;
        case "OPTIONS":
          method = HttpMethod.OPTIONS;
          break;
        case "CONNECT":
          method = HttpMethod.CONNECT;
          break;
        default:
          throw new Error("method '" + test.method + "'is not a HTTP method");
      }

      if (test.method === "GET") {
        reqBody = null;
      } else {
        reqBody = self.genReqBody({
          method:    test.method,
          reqdata:   test.reqdata,
          reqformat: test.reqformat,
          uploads:   test.uploads,
        });
      }

      const response = await self.request(
        test.url,
        reqBody,
        method,
        reqformat,
        (typeof test.uploads !== "undefined"),
      );

      // Assert status code
      if (response.status !== test.status) {
        throw new Error("Assertion Error: Status Code is expected to be \'" +
          test.status + "\' but returned \'" + response.status + "\'");
      }

      // Skip if resdata is not defined
      // Note: Do NOT skip when test.resdata === null. `if (!test.resdata) {...` skips when resdata is defined as `null`
      if (typeof test.resdata !== "undefined") {
        try {
          assert.deepStrictEqual(response.json, test.resdata);
        } catch (err) {
          throw new Error("Assertion Error: response data (resdata) is expected to be: \n" +
            test.resdata + "\n but returned: \n" + response.json);
        }
      }

      await Promise.all([
        self.assertDB(dbtables),
        self.assertUploads(dbtables),
      ]);

      if (typeof test.after === "function") {
        const afterResult = test.after();

        if (isPromise(afterResult)) {
          await afterResult;
        }
      }
    }
  }

  /**
   * Assert if expected data is stored on DB
   *
   * @param   {Object}  dbtables dbtables object
   * @returns {Promise<void>} Promise object
   */
  private async assertDB(dbtables: any) {
    return Promise.all(dbtables.map((table) => {
      if (!table.result || !table.result.data) {
        return Promise.resolve();
      }

      return table.table.fetchAll().then((_records) => {
        const records = _records
          .toJSON()
          .sort((record1, record2) => {
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
              if (expectedColumnData.values === actualColumnData) {
                return Promise.reject("Assertion Error: data[" + i + "][" + key + "]"
                  + " is expected NOT to be \'" + expectedColumnData.values + "\'");
              }
            } else if (typeof expectedColumnData === "function") {
              if (expectedColumnData(actualColumnData) !== true) {
                return Promise.reject("Assertion Error: data[" + i + "][" + key + "]"
                  + " is expected to pass test function but actual data \'"
                  + actualColumnData + "\' didn't pass");
              }
            } else { // expectedColumnData is literal
              // Check equality
              if (expectedColumnData !== actualColumnData) {
                return Promise.reject("Assertion Error: data[" + i + "][" + key + "]"
                  + " is expected to be \'" + expectedColumnData + "\' but actually \'"
                  + actualColumnData + "\'");
              }
            }
          }
        }

        return Promise.resolve();
      });
    }));
  }

  /**
   * Assert if expected uploaded data is stored in the storage
   *
   * @param {Object} dbtables dbtables object
   * @returns {Promise<void>} Promise object
   */
  private assertUploads(dbtables: any) {
    const self = this;

    return Promise.all(dbtables.map((table) => {
      return new Promise((resolve, reject) => {
        if (!table.result || !table.result.uploads) {
          resolve();
          return;
        }

        table.result.uploads.forEach((upload) => {
          const uploadedFileName = path.join(self.config.uploadDir, upload.filename);

          imageDiff({
            actualImage:   uploadedFileName,
            diffImage:     path.join(self.config.logDir, "images/diff"),
            expectedImage: upload.original,
          }, (err, imagesAreSame) => {
            if (err) {
              reject(err);
            }

            // Save image if images doesn't match
            if (!imagesAreSame) {
              const resultDir = path.join(__dirname, "../tmp/images"),
                    uploadedFileExists = fs.existsSync(uploadedFileName),
                    originalExists = fs.existsSync(upload.original);

              if (uploadedFileExists) {
                fs.copySync(uploadedFileName, path.join(resultDir, "uploaded"));
              }

              if (originalExists) {
                fs.copySync(upload.original, path.join(resultDir, "expected"));
              }

              if (!uploadedFileExists && !originalExists) {
                reject("Assertion Error: uploaded file '" + uploadedFileName
                  + "' and original file '" + upload.original + "' doesn't exist!");
                return;
              } else if (!uploadedFileExists) {
                reject("Assertion Error: uploaded file '" + uploadedFileName + "' doesn't exist!");
                return;
              } else if (!originalExists) {
                reject("Assertion Error: '" + upload.original + "' doesn't exist!");
                return;
              } else {
                reject("Assertion Error: uploaded file '" + uploadedFileName
                  + "' and original file '" + upload.original + "' are expected to be the same, but they differs.");
                return;
              }
            }

            resolve();
          });
        });
      });
    }));
  }

  /**
   * Cleanup existing data from directory and database
   *
   * @param  {Object} models Bookshelf model object
   * @returns {Promise} Promise object
   */
  private async cleanup(models) {
    // Empty storage directory
    fs.emptyDirSync(this.config.uploadDir);

    for (const model of models) {
      // Remove existing records
      await this.bookshelf.knex.raw("DELETE FROM " + model.tableName + ";");
      // Reset auto increment
      await this.bookshelf.knex.raw("ALTER TABLE " + model.tableName + " AUTO_INCREMENT = 1;");
    }

    return Promise.resolve();
  }

  /**
   * Create mock data
   *
   * @param {Object} dbtables dbtables object
   * @returns {Promise<void>} Promise object
   */
  private async createMock(dbtables: any): Promise<void> {
    const self = this;

    dbtables.map((dbtable) => {
      let procs: Array<Promise<void>> = [];

      //
      // Mock data (DB)
      //
      if (dbtable.mock) {
        if (!Array.isArray(dbtable.mock.data)) {
          dbtable.mock.data = [dbtable.mock.data];
        }

        // Insert mock data on DB
        procs = procs.concat(procs, dbtable.mock.data.map((record) => {
          return new dbtable.table(record).save({}, { method: "insert" });
        }));
      }

      //
      // Mock data (Upload files)
      //
      if (dbtable.mock && dbtable.mock.uploads) {
        procs = procs.concat(procs, dbtable.mock.uploads.map((upload) => {
          return new Promise((resolve, reject) => {
            // Upload resources
            fs.copy(upload.src, path.join(self.config.uploadDir, upload.dest), (err) => {
              if (err) {
                reject(err);
              }
              resolve();
            });
          });
        }));
      }

      return Promise.all(procs);
    });
  }

  /**
   * Generate request body
   *
   * @param   {Object} opts arguments to pass
   * @param   {string} opts.method HTTP method to use
   * @param   {Object} opts.reqdata Request parameters to send
   * @param   {Object} opts.reqformat Request format: JSON or FORM
   * @param   {Object} [opts.uploads=undefined] Object of key-value pairs which expresses file name and path to dummy uploading file
   * @returns {string} request body to send
   */
  private genReqBody(opts) {
    const method = opts.method,
          reqdata = opts.reqdata,
          reqformat = opts.reqformat,
          uploads = opts.uploads;

    if (method === "GET") {
      throw new Error("This should be restament's bug!\nThis method should not run when requesting in GET. Users should add parameters in URL.");
    }

    if (!(
      method === "POST"
      || method === "PUT"
      || method === "PATCH"
      || method === "DELETE"
      || method === "HEAD"
      || method === "OPTIONS"
      || method === "CONNECT"
    )) {
      throw new Error("Argument opts.method is undefined");
    } else if (typeof reqdata === "undefined") {
      throw new Error("Argument opts.reqdata is undefined");
    } else if (!(
      reqformat === "FORM"
      || method === "JSON"
    )) {
      throw new Error("Argument opts.reqformat must be FORM or JSON");
    }

    //
    // Prepare data to post/put
    //
    if (reqformat === "FORM") {
      const reqBody = new FormData();

      for (const key of Object.keys(reqdata)) {
        // Workaround: Node.js's form-data doesn't support array as form value, unlike browser implementation.
        // You need to join with comma instead.
        reqBody.append(key, Array.isArray(reqdata[key]) ? reqdata[key].join(",") : reqdata[key]);
      }

      if ((method === "POST" || method === "PUT") && uploads) {
        for (const key of Object.keys(uploads)) { // Uploading file(s)
          reqBody.append(key, fs.createReadStream(uploads[key]));
        }
      }

      return reqBody;
    } else { // if test.reqformat === "JSON" or unspecified
      if (uploads) { // When upload file is specified, you need to send as form data
        throw new Error("Cannot upload files with data in JSON format");
      }

      return JSON.stringify(reqdata);
    }
  }

  private async request(url: string, reqBody: string, method: HttpMethod, reqformat: RequestFormat, upload: boolean = false) {
    //
    // Testing REST API
    //
    let contentType,
        response: any = {};

    if (reqformat === RequestFormat.JSON) {
      contentType = "application/json";
    } else if (reqformat === RequestFormat.Form) {
      if (upload) {
        contentType = "multipart/form-data";
      } else {
        contentType = "application/x-www-form-urlencoded";
      }
    }

    return fetch(this.config.endpoint + url, {
      body:   reqBody,
      header: {
        "Content-Type": contentType,
      },
      method: method,
    }).then((res) => {
      response.status = res.status;
      return res.text();
    }).then((body) => {
      try {
        response.json = JSON.parse(body);
        return Promise.resolve();
      } catch (err) {
        if (err instanceof SyntaxError) {
          return Promise.reject("Response body is not JSON! Response body is:\n"
            + "--------------------\n"
            + body + "\n"
            + "--------------------\n");
        } else {
          return Promise.reject(err);
        }
      }
    }).then(() => {
      return Promise.resolve(response);
    });
  }
};
