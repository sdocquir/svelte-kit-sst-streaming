import fs from "node:fs";
import path from "node:path";
import { installPolyfills } from "@sveltejs/kit/node/polyfills";
import type { Server as ServerType } from "@sveltejs/kit";
// @ts-ignore
import { Server } from "../index.js";
// @ts-ignore
import { manifest } from "../manifest.js";
// @ts-ignore
import prerenderedFiles from "./prerendered-file-list.js";
import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyEvent,
	CloudFrontRequestEvent,
} from "aws-lambda";
import type { ResponseStream } from "./types.js";
import { InternalEvent, convertFrom, convertTo } from "./event-mapper.js";
import { debug } from "./logger.js";
import { isBinaryContentType } from "./binary.js";

installPolyfills();

const app: ServerType = new Server(manifest);
await app.init({ env: process.env as Record<string, string> });

export const handler: any = awslambda.streamifyResponse(handlerInternal)


async function handlerInternal(
	event: APIGatewayProxyEventV2 | CloudFrontRequestEvent | APIGatewayProxyEvent,
	responseStream: ResponseStream
) {
	debug("event", event);

	// Parse Lambda event
	const internalEvent = convertFrom(event);

	// Check request is for prerendered file
	if (internalEvent.method === "GET") {
	  const filePath = isPrerenderedFile(internalEvent.rawPath);
	  if (filePath) {
	    return internalEvent.type === "cf"
	      ? formatCloudFrontPrerenderedResponse(
	          event as CloudFrontRequestEvent,
	          filePath
	        )
	      : formatAPIGatewayPrerenderedResponse(internalEvent, filePath);
	  }
	}

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

	const response: Response = await app.respond(request, {
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
		})
	}
	return streamError(404, "Not found", responseStream);
}

function streamError(
	statusCode: number,
	error: string | Error,
	responseStream: ResponseStream
) {
	console.error(error);

	responseStream = awslambda.HttpResponseStream.from(responseStream, {
		statusCode,
	});

	responseStream.write(error.toString());
	responseStream.end();
}

function isPrerenderedFile(uri: string) {
	// remove leading and trailing slashes
	uri = uri.replace(/^\/|\/$/g, "");

	if (uri === "") {
		return prerenderedFiles.includes("index.html") ? "index.html" : undefined;
	}

	if (prerenderedFiles.includes(uri)) {
		return uri;
	}
	if (prerenderedFiles.includes(uri + "/index.html")) {
		return uri + "/index.html";
	}
	if (prerenderedFiles.includes(uri + ".html")) {
		return uri + ".html";
	}
}

function formatCloudFrontPrerenderedResponse(
	event: CloudFrontRequestEvent,
	filePath: string
) {
	const request = event.Records[0].cf.request;
	request.uri = `/${filePath}`;
	return request;
}

function formatAPIGatewayPrerenderedResponse(
	internalEvent: InternalEvent,
	filePath: string
) {
	const response = new Response(fs.readFileSync(path.join("prerendered", filePath), "utf8"), {
		headers: {
			"content-type": "text/html",
			"cache-control": "public, max-age=0, s-maxage=31536000, must-revalidate",
		},
		status: 200,
	});
	return convertTo({
		type: internalEvent.type,
		response: response,
	});
}
