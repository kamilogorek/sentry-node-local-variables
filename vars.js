import * as inspector from "node:inspector";

// NOTE: Promise API is available as `Experimental` and in Node 19 only.
// Callback-based API is `Stable` since v14 and `Experimental` since v8.
// Because of that, we are creating our own `AsyncSession` class.
// https://nodejs.org/docs/latest-v19.x/api/inspector.html#promises-api
// https://nodejs.org/docs/latest-v19.x/api/inspector.html
// https://chromedevtools.github.io/devtools-protocol/v8/Debugger
// https://chromedevtools.github.io/devtools-protocol/v8/Runtime

class AsyncSession extends inspector.Session {
  async getProperties(objectId) {
    return new Promise((resolve, reject) => {
      this.post(
        "Runtime.getProperties",
        {
          objectId,
          ownProperties: true,
        },
        (err, params) => {
          if (err) {
            reject(err);
          } else {
            resolve(params.result);
          }
        }
      );
    });
  }
}

export class LocalVariables {
  static id = "LocalVariables";

  name = LocalVariables.id;

  constructor() {
    this.session = new AsyncSession();
    this.session.connect();
    this.session.on("Debugger.paused", this.handlePaused.bind(this));
    this.session.post("Debugger.enable");
    this.session.post("Debugger.setPauseOnExceptions", { state: "all" });
  }

  setupOnce(addGlobalEventProcessor) {
    addGlobalEventProcessor(async (event) => this.addLocalVariables(event));
  }

  handlePaused = async ({ params }) => {
    // TODO: Exceptions only for now
    // TODO: Handle all frames
    if (params.reason == "exception") {
      // if (params.reason == "promiseRejection" || params.reason == "exception") {
      const topFrame = params.callFrames[0];
      const localScope = topFrame.scopeChain.find(
        (scope) => scope.type === "local"
      );

      if (!localScope) {
        console.log("no local scope");
        return;
      }

      this.props = await this.unrollProps(
        await this.session.getProperties(localScope.object.objectId)
      );
    }
  };

  // TODO: Handle nested depths
  async unrollProps(props) {
    const unrolled = {};

    for (const prop of props) {
      if (prop.value.className === "Array") {
        unrolled[prop.name] = await this.unrollArray(prop.value.objectId);
      } else if (prop.value.className === "Object") {
        unrolled[prop.name] = await this.unrollObject(prop.value.objectId);
      } else {
        unrolled[prop.name] = prop.value.value || `<${prop.value.description}>`;
      }
    }

    return unrolled;
  }

  async unrollArray(objectId) {
    const props = await this.session.getProperties(objectId);
    return props
      .filter((v) => v.name !== "length")
      .sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10))
      .map((v) => v.value.value);
  }

  async unrollObject(objectId) {
    const props = await this.session.getProperties(objectId);
    return Object.fromEntries(props.map((v) => [v.name, v.value.value]));
  }

  // TODO: This is not 100% safe, as we cannot assume it will be _this_ exception from debugger
  // we will need to keep a LRU-cache or similar in order to make it reliable.
  // TODO: Handle all frames
  async addLocalVariables(event) {
    event.exception.values[0].stacktrace.frames.reverse()[0].vars = {
      ...this.props,
    };
    return event;
  }
}
