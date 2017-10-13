import * as express from "express";

export function getExternalPort(request: express.Request): number {
	function defaultPort(): number {
		// Default ports for HTTP and HTTPS
		return request.protocol === "http" ? 80 : 443;
	}

	let host = request.headers.host;
	if (!host || Array.isArray(host)) {
		return defaultPort();
	}

	// IPv6 literal support
	let offset = host[0] === "[" ? host.indexOf("]") + 1 : 0;
	let index = host.indexOf(":", offset);
	if (index !== -1) {
		return parseInt(host.substring(index + 1), 10);
	}
	else {
		return defaultPort();
	}
}

export function createLink(request: express.Request, link: string, proto?: string): string {
	if (!proto) {
		proto = "http";
	}
	if (link[0] === "/") {
		link = link.substring(1);
	}
	if ((request.secure && getExternalPort(request) === 443)
		|| (!request.secure && getExternalPort(request) === 80))
	{
		return `${proto}${request.secure ? "s" : ""}://${request.hostname}/${link}`;
	}
	else {
		return `${proto}${request.secure ? "s" : ""}://${request.hostname}:${getExternalPort(request)}/${link}`;
	}
}
