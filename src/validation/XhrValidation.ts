import { gotScraping, Method, Response } from "got-scraping";
import { OptionsInit } from 'got-scraping';
import { isEqual } from "lodash";
import { DOMSearch } from "../search/DOMSearch";
import { JsonSearcher } from "../search/JsonSearch";
import { DataOrigin, GotCall, GotCallType, NormalizedKeywordPair, SearchResult, XhrSearchResult, XhrValidation } from "../types";
import { log } from '@crawlee/core';
import { prettyPrint } from "html";

export async function validateAllXHR(xhrSearchResults: XhrSearchResult[], keywords: NormalizedKeywordPair[], proxyUrl: string | undefined = undefined): Promise<XhrValidation[]> {

    let validatedXhr: XhrValidation[] = [];
    if (xhrSearchResults.length > 0) {
        let index = 0;
        try {

            // xhrSearchResults.forEach((xhrFound, index) => {
            //     const val = await validateXHRRequest(xhrFound, keywords, index);
            //     validatedXhr.push(val);
            // });
            for (const xhrFound of xhrSearchResults) {
                // TODO: only validate unique requests
               if (xhrFound.parsedRequestResponse.initial) {
                 log.debug("Initial request wont be validated using got.")

               } else {
                const val = await validateXHRRequest(xhrFound, keywords, index, proxyUrl);
                 validatedXhr.push(val);
                 index++;
               } 
            }

        }
        catch (err: any) {
            // TODO: error handling
            log.error(err);
            log.error(`Failed validation of XHR request: ${""}`);
        }
    }
    return validatedXhr;
}

async function validateXHRRequest(xhr: XhrSearchResult, keywords: NormalizedKeywordPair[], index: number, proxyUrl: string | undefined = undefined): Promise<XhrValidation> {
    let callsWithMinimal: GotCall[] = [];
    let callsWithOriginalHeaders: GotCall[] = [];
    let callsWithOriginalCookie: GotCall[] = [];


    const filteredHeaders: { [key: string]: string } = {};

    // Remove pseudo-headers
    Object.keys(xhr.parsedRequestResponse.request.headers).forEach(headerKey => {
        if (headerKey.indexOf(":") == -1) {
            filteredHeaders[headerKey] = xhr.parsedRequestResponse.request.headers[headerKey]
        }
    });
    const options: OptionsInit = {
        proxyUrl: proxyUrl,
        method: xhr.parsedRequestResponse.request.method as Method,
        body: xhr.parsedRequestResponse.request.body ?? undefined,
        url: xhr.parsedRequestResponse.request.url,
        timeout: { response: 30000 },

    }
    let succeeded = false;

    // calls with minimal headers
    const minimalHeaders: { [key: string]: string } = {};
    // check referer and content type if payload is present
    const referer = filteredHeaders["referer"];
    if (referer != null && referer != "") {
        minimalHeaders["referer"] = referer;
    }

    //copy request body and content type
    if (options.body) {
        minimalHeaders["content-type"] = filteredHeaders["content-type"];
    }

    // log.debug("Minimal headers" + JSON.stringify(minimalHeaders));
    options.headers = minimalHeaders;
    // trying every request multiple times to avoid false negatives due to proxy limitations
    for (let i = 0; i < 5; i++) {

        const callValidation = await validateGotCall(xhr, keywords, options, "minimalHeaders");
        callsWithMinimal.push(callValidation);

        if (callValidation.isValid) {
            succeeded = true;
            break;
        }
    }

    // calls with original headers from chromium without a cookie
    if (!succeeded) {
        const originalHeadersWithoutCookie: { [key: string]: string } = { ...filteredHeaders };
        delete originalHeadersWithoutCookie["cookie"]
        options.headers = originalHeadersWithoutCookie;

        for (let i = 0; i < 5; i++) {

            const callValidation = await validateGotCall(xhr, keywords, options, "withouCookieHeaders");
            callsWithOriginalHeaders.push(callValidation);

            if (callValidation.isValid) {
                succeeded = true;
                break;
            }
        }

    }
    // calls with original headers including a cookie
    if (!succeeded) {
        options.headers = filteredHeaders;

        for (let i = 0; i < 5; i++) {

            const callValidation = await validateGotCall(xhr, keywords, options, "originalHeaders");
            callsWithOriginalCookie.push(callValidation);

            if (callValidation.isValid) {
                succeeded = true;
                break;
            }
        }
    }

    let lastCall: GotCall | null = callsWithOriginalCookie.length > 0 ? callsWithOriginalCookie[callsWithOriginalCookie.length - 1] : null;
    lastCall = lastCall == null && callsWithOriginalHeaders.length > 0 ? callsWithOriginalHeaders[callsWithOriginalHeaders.length - 1] : lastCall;
    lastCall = lastCall == null && callsWithMinimal.length > 0 ? callsWithMinimal[callsWithMinimal.length - 1] : lastCall;

    return {
        originalRequestResponse: xhr.parsedRequestResponse,
        callsMinimalHeaders: callsWithMinimal,
        callsWithOriginalHeaders: callsWithOriginalHeaders,
        callWithCookies: callsWithOriginalCookie,
        validationSuccess: succeeded,
        xhrSearchResult: xhr,
        index: index,
        lastCall: lastCall
    }
}

async function validateGotCall(xhr: XhrSearchResult, keywords: NormalizedKeywordPair[], options: OptionsInit, gotCallType: GotCallType): Promise<GotCall> {
    const request = gotScraping(options);
    let response: Response<string>;
    let searchResults: SearchResult[] = [];
    let result: GotCall = {
        callSuccess: true,
        isValid: false,
        keywordsFound: [],
        parsedRequestResponse: {
            request: {
                body: xhr.parsedRequestResponse.request.body,
                headers: options.headers as { [key: string]: string },
                method: xhr.parsedRequestResponse.request.method,
                url: xhr.parsedRequestResponse.request.url
            },
            response: {
                body: "",
                // TODO: this is not working well 
                status: -1,
                headers: {}
            },
            error: null,
            initial: false,
        },
        searchResults: [],
        callType: gotCallType
    }
    try {
        // log.debug("Tryign with headers: " + gotCallType.toString())
        response = (await request) as Response<string>;
        if (response.statusCode == xhr.parsedRequestResponse.response.status) {
            // reponses are the same, we can proceed
            // log.debug("Response with the same status received: " + response.statusCode);

            if (response.headers["content-type"]?.indexOf("json") != -1) {
                searchResults = (new JsonSearcher()).searchJson(JSON.parse(response.body), keywords, DataOrigin.xhr);
            } else if (response.headers["content-type"].indexOf("html") != 1) {
                searchResults = (new DOMSearch(response.body, DataOrigin.xhr)).find(keywords);
            }
            result.searchResults = searchResults;

            if (searchResults.length > 0) {
                const keywordsFound: NormalizedKeywordPair[] = []
                xhr.searchResults.forEach(searchResult => {
                    if (!keywordsFound.includes(searchResult.keyword)) {
                        keywordsFound.push(searchResult.keyword);
                    }

                });

                // if the search results of the response body are the same as search results obtained during analysis
                if (isEqual(searchResults, xhr.searchResults)) {
                    log.info("Validated xhr is valid.");
                    result.isValid = true;
                    result.searchResults.forEach(sr => {
                        sr.source.push(DataOrigin.got);
                    })

                } else {
                    log.info("Validated xhr is invalid.")
                }

            }
            result.parsedRequestResponse.response = {
                body: prettyPrint(response.body, { indent_size: 3 }),
                status: response.statusCode,
                headers: response.headers as { [key: string]: string }
            };
        } else {
            log.debug("Response with different status received: " + response.statusCode);
            log.debug("URL: " + response.url);

        }
    } catch (err: any) {
        result.callSuccess = false;
        result.isValid = false;
    }
    return result;
}
