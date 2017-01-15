"use strict";

import * as liteServer from "lite-server";
import * as browserSync from "browser-sync";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { Restament } from "../index";

describe("restament", () => {
  const port = 10999;
  let server;

  before(() => {
    server = http.createServer((request, response) => {
      fs.readFile(path.join("./jsons", request.url), (err, data) => {
        if (err) {
          response.writeHead(404, { "Content-type": "text/plain" });
          response.end("Not found");
        } else {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(data);
        }
      });
    });
    server.listen(port);
  });

  after(() => {
    server.close((err) => {
      if (err) {
        console.error("Failed to close server");
        throw err;
      }
    });
  })

  it("should run", () => {
    const restament = new Restament({
      db:        {
        host:     "localhost",
        name:     "restament",
        password: "restament",
        user:     "restament",
      },
      endpoint:  "http://localhost:" + port,
      logDir:    path.join(__dirname, "/../tmp/logs"),
      uploadDir: path.join(__dirname, "/../tmp/build/api/storage"),
    });

    restament.test({
      url:       "/test.json",
      method:    "GET",
      reqformat: "JSON",
      reqdata:   {
        order: 0,
      },
      status:  200,
      resdata: [
        {
          id:    "1",
          order: "0",
        },
        {
          id:    "2",
          order: "1",
        },
      ],
      db: {
        tablename: tableName + tableSuffix,
        mock:      {
          data: [
            {
              id:    1,
              order: 0,
            },
            {
              id:    2,
              order: 1,
            },
          ],
          uploads: [
            {
              src:  path.join(__dirname, "uploads/indexbgs-1.png"),
              dest: "indexbgs/1/indexbg",
            },
            {
              src:  path.join(__dirname, "uploads/indexbgs-2.jpeg"),
              dest: "indexbgs/2/indexbg",
            },
          ],
        },
      },
    });
  });
});
