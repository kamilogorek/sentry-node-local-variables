import * as inspector from "node:inspector";

// https://nodejs.org/docs/latest-v19.x/api/inspector.html
// https://chromedevtools.github.io/devtools-protocol/v8/Debugger
// https://chromedevtools.github.io/devtools-protocol/v8/Runtime

function getLocalScopesForFrames(matchedFrames, options, callback) {
  async.each(
    matchedFrames,
    getLocalScopeForFrame.bind({ options: options }),
    callback
  );
}

function getLocalScopeForFrame(matchedFrame, callback) {
  var options = this.options;
  var scopes = matchedFrame.callFrame.scopeChain;

  var scope = scopes.find((scope) => scope.type === "local");

  if (!scope) {
    return callback(null); // Do nothing return success.
  }

  getProperties(scope.object.objectId, function (err, response) {
    if (err) {
      return callback(err);
    }

    var locals = response.result;
    matchedFrame.stackLocation.locals = {};
    var localsContext = {
      localsObject: matchedFrame.stackLocation.locals,
      options: options,
      depth: options.depth,
    };
    async.each(locals, getLocalValue.bind(localsContext), callback);
  });
}

function getLocalValue(local, callback) {
  var localsObject = this.localsObject;
  var options = this.options;
  var depth = this.depth;

  function cb(error, value) {
    if (error) {
      // Add the relevant data to the error object,
      // taking care to preserve the innermost data context.
      if (!error.rollbarContext) {
        error.rollbarContext = local;
      }
      return callback(error);
    }

    if (Array.isArray(localsObject)) {
      localsObject.push(value);
    } else {
      localsObject[local.name] = value;
    }
    callback(null);
  }

  if (!local.value) {
    return cb(null, "[unavailable]");
  }

  switch (local.value.type) {
    case "undefined":
      cb(null, "undefined");
      break;
    case "object":
      getObjectValue(local, options, depth, cb);
      break;
    case "function":
      cb(null, getObjectType(local));
      break;
    case "symbol":
      cb(null, getSymbolValue(local));
      break;
    default:
      cb(null, local.value.value);
      break;
  }
}

function getObjectType(local) {
  if (local.value.className) {
    return "<" + local.value.className + " object>";
  } else {
    return "<object>";
  }
}

function getSymbolValue(local) {
  return local.value.description;
}

function getObjectValue(local, options, depth, callback) {
  if (!local.value.objectId) {
    if ("value" in local.value) {
      // Treat as immediate value. (Known example is `null`.)
      return callback(null, local.value.value);
    }
  }

  if (depth === 0) {
    return callback(null, getObjectType(local));
  }

  getProperties(local.value.objectId, function (err, response) {
    if (err) {
      return callback(err);
    }

    var isArray = local.value.className === "Array";
    var length = isArray ? options.maxArray : options.maxProperties;
    var properties = response.result.slice(0, length);
    var localsContext = {
      localsObject: isArray ? [] : {},
      options: options,
      depth: depth - 1,
    };

    // For arrays, use eachSeries to ensure order is preserved.
    // Otherwise, use each for faster completion.
    var iterator = isArray ? async.eachSeries : async.each;
    iterator(properties, getLocalValue.bind(localsContext), function (error) {
      if (error) {
        return callback(error);
      }

      callback(null, localsContext.localsObject);
    });
  });
}

function getProperties(objectId, callback) {
  Locals.session.post(
    "Runtime.getProperties",
    { objectId: objectId, ownProperties: true },
    callback
  );
}

export class LocalVariables {
  static id = "LocalVariables";

  name = LocalVariables.id;

  constructor() {
    this.session = new inspector.Session();
    this.session.connect();

    this.props = null;

    this.session.on("Debugger.paused", ({ params }) => {
      // console.log(params);
      // if (params.reason == "promiseRejection" || params.reason == "exception") {
      if (params.reason == "exception") {
        const topFrame = params.callFrames[0];
        // params.callFrames.forEach((frame) => {
        const local = topFrame.scopeChain.find(
          (scope) => scope.type === "local"
        );
        if (!local) {
          console.log("no local scope");
          return;
        }
        const objectId = local.object.objectId;

        this.session.post(
          "Runtime.getProperties",
          { objectId, ownProperties: true },
          (err, res) => {
            console.log("Runtime.getProperties");
            console.log(
              res.result.map((v) => ({
                [v.name]: v.value.value || `<${v.value.description}>`,
              }))
            );
            this.props = Object.fromEntries(
              res.result.map((v) => [
                v.name,
                v.value.value || `<${v.value.description}>`,
              ])
            );
          }
        );
        // const objectId = params.callFrames[0].scopeChain[2].object.objectId;
        // console.log(objectId);
      }
    });

    this.session.post("Debugger.enable", (err, res) =>
      console.log("Debugger.enable")
    );

    this.session.post(
      "Debugger.setPauseOnExceptions",
      { state: "all" },
      (err, res) => console.log("Debugger.setPauseOnExceptions")
    );
  }

  setupOnce(addGlobalEventProcessor) {
    addGlobalEventProcessor(async (event) => {
      return this.addSourceContext(event);
    });
  }

  async addSourceContext(event) {
    console.log(this.props);
    event.exception.values[0].stacktrace.frames.reverse()[0].vars = {
      ...this.props,
    };
    // console.log(topFrame);
    // console.log(this.props);
    return event;
  }
}
