Restament
=========

[![Waffle.io](https://badge.waffle.io/phanect/restament.png?label=ready&title=Ready)](https://waffle.io/phanect/restament)

Restament is a testing framework for REST APIs.
You can declare tests with JSON-like format.

Install
-------

```shell
npm install --save restament
```

Usage
-----

```javascript
"use strict";

const Restament = require("restament");

let restament = new Restament({
  endpoint:  "https://api.example.io/v0/", // API Endpoint
  uploadDir: "./tmp/uploads", // Directory to store uploaded files
  logDir:    "./tmp/logs", // Directory to store logs
  db: { // Configuration for connecting to the Database
    host:     "localhost",
    name:     "dbname",
    user:     "username",
    password: "password"
  }
});

restament.test([
  {
    url:       "/v1/messages", // API URL
    method:    "POST", // HTTP method
    reqformat: "JSON", // Format to send data: `JSON` (json) or `FORM` (form data)
    reqdata:   { // Request parameters
      text: "Hello, Restament!"
    },
    status:  200, // Expected status code
    resdata: { // Expected return JSON
      success: true
    },
    // You can create data before the test, and verify if expected data is stored on DB,
    db: {
      tablename: "messages", // Table name
      mock:      {
        /*
         * Mock data which inserted before this test
         * In this example, following SQL command runs:
         * INSERT INTO messages (id, text, postedAt, attachedImage)
         * VALUES (0, "Hello, World!", "2016-09-01 14:03:01", NULL),
         *   (1, "Goodbye, World...", "2016-09-02 11:26:24","djtv9VvnawQE7ZQTj7N2d70Xy6jb1cPZICtFY5EqMDt7YFLSv7IHN4SvmegZEl");
         */
        data: [
          {
            id:        0,
            text:      "Hello, World!",
            postedAt:  "2016-09-01 14:03:01"
          }
        ],
        uploads: [
          {
            src:  "uploads/indexbgs-1.png",
            dest: "djtv9VvnawQE7ZQTj7N2d70Xy6jb1cPZICtFY5EqMDt7YFLSv7IHN4SvmegZEl"
          }
        ]
      },
      result:      { // Mock data which inserted before this test
        data: [
          {
            id:       function(actualData) { // return true if assertion succeed. If failed, return false.
              return (typeof actualData === "number"); // If data is number, assertion succeed.
            },
            text:     Restament.not("Hello, World!"),
            postedAt: "2016-09-01 14:03:01"
          },
          {
            id:       function(actualData) {
              return (typeof actualData === "number");
            },
            text:          "Goodbye, World...",
            postedAt:      "2016-09-02 11:26:24",
            attachedImage: "djtv9VvnawQE7ZQTj7N2d70Xy6jb1cPZICtFY5EqMDt7YFLSv7IHN4SvmegZEl"
          }
        ],
        /* Upload files.
         * Just copies uploads/indexbgs-1.png under `uploadDir` with name "djtv9Vvna.png"
         * This is not actually DB data, but coz' upload files are often associated with DB data,  it is categorized as DB stuff.
         */
        uploads: [
          {
            filename: "djtv9VvnawQE7ZQTj7N2d70Xy6jb1cPZICtFY5EqMDt7YFLSv7IHN4SvmegZEl",
            original:  "uploads/indexbgs-1.png"
          }
        ]
      }
    },
    // You can run arbitrary code before & after the tests
    // Every function has to return Promise object.
    before: function() {
      return Promise.resolve();
    },
    after: function() {
      return Promise.resolve();
    }
  }
]);
```
