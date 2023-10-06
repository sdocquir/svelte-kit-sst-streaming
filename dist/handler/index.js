import { installPolyfills } from "@sveltejs/kit/node/polyfills";
// @ts-ignore
import { Server } from "../index.js";
// @ts-ignore
import { manifest } from "../manifest.js";
import { convertFrom, convertTo } from "./event-mapper.js";
import { debug } from "./logger.js";
installPolyfills();
const app = new Server(manifest);
await app.init({ env: process.env });
export const handler = awslambda.streamifyResponse(handlerInternal);
function streamError(statusCode, error, responseStream) {
    console.error(error);
    responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode,
    });
    responseStream.write(error.toString());
    responseStream.end();
}
async function handlerInternal(event, responseStream) {
    debug("event", event);
    // Parse Lambda event
    const internalEvent = convertFrom(event);
    // Check request is for prerendered file
    // if (internalEvent.method === "GET") {
    //   const filePath = isPrerenderedFile(internalEvent.rawPath);
    //   if (filePath) {
    //     return internalEvent.type === "cf"
    //       ? formatCloudFrontPrerenderedResponse(
    //           event as CloudFrontRequestEvent,
    //           filePath
    //         )
    //       : formatAPIGatewayPrerenderedResponse(internalEvent, filePath);
    //   }
    // }
    // Process request
    const requestUrl = internalEvent.url;
    const requestProps = {
        method: internalEvent.method,
        headers: internalEvent.headers,
        body: ["GET", "HEAD"].includes(internalEvent.method)
            ? undefined
            : internalEvent.body,
    };
    debug("request", requestUrl, requestProps);
    const request = new Request(requestUrl, requestProps);
    const response = await app.respond(request, {
        getClientAddress: () => internalEvent.remoteAddress,
    });
    debug("response", response);
    //stream response back to Cloudfront
    //Parse the response into lambda proxy response
    if (response) {
        await convertTo({
            type: internalEvent.type,
            response,
            responseStream,
            cookies: undefined
        });
    }
    // return {
    //   streamError(404, "Not found", responseStream);
    // };
}
// function isPrerenderedFile(uri: string) {
//   // remove leading and trailing slashes
//   uri = uri.replace(/^\/|\/$/g, "");
//   if (uri === "") {
//     return prerenderedFiles.includes("index.html") ? "index.html" : undefined;
//   }
//   if (prerenderedFiles.includes(uri)) {
//     return uri;
//   }
//   if (prerenderedFiles.includes(uri + "/index.html")) {
//     return uri + "/index.html";
//   }
//   if (prerenderedFiles.includes(uri + ".html")) {
//     return uri + ".html";
//   }
// }
// function formatCloudFrontPrerenderedResponse(
//   event: CloudFrontRequestEvent,
//   filePath: string
// ) {
//   const request = event.Records[0].cf.request;
//   request.uri = `/${filePath}`;
//   return request;
// }
// function formatAPIGatewayPrerenderedResponse(
//   internalEvent: InternalEvent,
//   filePath: string
// ) {
//   return convertTo({
//     type: internalEvent.type,
//     statusCode: 200,
//     headers: {
//       "content-type": "text/html",
//       "cache-control": "public, max-age=0, s-maxage=31536000, must-revalidate",
//     },
//     isBase64Encoded: false,
//     body: fs.readFileSync(path.join("prerendered", filePath), "utf8"),
//   });
// }
