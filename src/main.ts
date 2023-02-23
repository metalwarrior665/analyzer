import { getCUrrentDate, normalizeArray } from './helpers/normalize';
import { PlaywrightScraper } from "./scraper/PlaywrightScraper";
import { Input, Output } from "../src/types";
import { searchData } from './search/Search';
import { Validator } from './validation/Validator';
import { readFileSync } from "fs";
import { KeyValueStore, log } from '@crawlee/core';
import { Actor } from 'apify';
import { crawl } from './crawl/Crawler';
import dayjs from 'dayjs'
import { parse, html } from "diff2html";
import { createTwoFilesPatch } from 'diff';
/*
 * Actor's entry point. 
 */
(async () => {
    Actor.init();
    const output = new Output();
    let store: KeyValueStore;
    let input: Input;

    try {
        input = await KeyValueStore.getInput() as Input;
    } catch (e: any) {
        log.error("Failed to load the input");
        // TODO: exit gracefully when the actor fails to load the input
        log.error(e.message);
    }
    try {
        store = await Actor.openKeyValueStore(`runs/${dayjs(new Date()).format('YYYY-MM-DD_HH-mm-ss')}`);
        await store.setValue("INPUT", JSON.stringify(input!), { contentType: "application/json; charset=utf-8" })

    } catch (e: any) {
        log.error('Failed to create a key-value store with the current date');
        log.error(e.message);
        log.debug("Using default store.")
        store = await Actor.openKeyValueStore("default");
    }

    try {

        // if running locally you can uncomment this to try out some of the example inputs
        // (async () => {
        //     if (process.env.NODE_ENV != "production") {
        //         // Copy input from input examples   
        //         const inputFile = "./src/static/example_inputs/INPUT_MALL.json"
        //         await KeyValueStore.setValue("INPUT", readFileSync(inputFile), { contentType: "application/json; charset=utf-8" })
        //         log.debug("Running in dev mode");
        //     }
        // })();

        log.setLevel(log.LEVELS.DEBUG);

        // Structure of the input is defined in /INPUT_SCHEMA.json.
        // This function expects INPUT.json file in the key-value storage
        // which defaults to /storage/key_value_stores.
        const input = await KeyValueStore.getInput() as Input;
        const normalizedKeywords = normalizeArray(input.keywords);
        // TODO: analyze url and query parameters
        const params = new URLSearchParams(input.url);
        output.setInput(input.url, normalizedKeywords);

        // Copy frontend application to keyvalue store, this file is generated by project analyzer-ui, mentioned in the readme.
        // On the Apify platform, this file is copied during actor's build in docker.
        await KeyValueStore.setValue("DASHBOARD", readFileSync("./src/static/index.html"), { contentType: 'text/html; charset=utf-8' });
        await store.setValue("DASHBOARD", readFileSync("./src/static/index.html"), { contentType: 'text/html; charset=utf-8' });

        // TODO: fix formatting
        log.info("INPUT", input);
        log.info('===================================================================================================================');
        log.info('Welcome to the page analyzer!');
        log.info('URL: ' + input.url);
        log.info('KEYWORDS: ' + input.keywords);
        log.info('===================================================================================================================');
        output.analysisStarted = getCUrrentDate();



        // navigate to the website
        const scraper = new PlaywrightScraper(input.url, normalizedKeywords, store);
        // scrape and parse the data 
        const scrapedData = await scraper.scrapePage(true, true);
        // close the browser
        // scraper.close();

        // after the data is loaded and parsed we can search for keywords 
        const searchResults = searchData(scrapedData, normalizedKeywords);

        // retrieve initial response with the CheerioCrawler and validate the search results
        const validator = new Validator(store);
        const validatedData = await validator.validate(input.url, normalizedKeywords, searchResults);

        // save the output
        output.scrapedData = scrapedData;
        output.searchResults = searchResults;
        output.keywordConclusions = validatedData.conclusion;
        output.xhrValidated = validatedData.xhrValidated;
        output.cheerioCrawlerSuccess = validatedData.cheerioCrawlerSuccess;
        output.scrapedData.parsedCheerio = validatedData.parsedCheerio;
        // TODO: create and run the crawler

        // await crawl(input.url, output.keywordConclusions);

        // error for testing purposes
        // throw new Error("Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book. It has survived not only five centuries, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised in the 1960s with the release of Letraset sheets containing Lorem Ipsum passages, and more recently with desktop publishing software like Aldus PageMaker including versions of Lorem Ipsum.")


    } catch (e: any) {

        // TODO: more sophisticated error handling
        log.error('Top lever error inside main:');
        log.error(e.message);
        console.error(e);
        output.actorSuccess = false;
        output.errorMessage = e.message;

    }
    output.analysisEnded = getCUrrentDate();

    // TODO: calculate git diff and save it to the storage to be later displayed in the UI
    // prettify -> save -> load compare

    // await KeyValueStore.get("./src/static/diff.txt", readFileSync("diff.txt"), { contentType: "application/json; charset=utf-8" });

    try {

        const difdiff = createTwoFilesPatch("", "", output.scrapedData!.initial!.body, output.scrapedData!.DOM!.body, "Initial response", "Rendered document");
        log.debug(difdiff);

        // await KeyValueStore.setValue("diffstring", diffString, { contentType: 'application/text; charset=utf-8' });
        // await store.setValue("diffstring", diffString, { contentType: 'application/text; charset=utf-8' });


        const diffJson = parse(difdiff);
        const diffHtml = html(diffJson, { outputFormat: 'side-by-side', drawFileList: false });
        log.debug(diffHtml);
        await KeyValueStore.setValue("diff", diffHtml, { contentType: 'application/html; charset=utf-8' });
        await store.setValue("diff", diffHtml, { contentType: 'application/html; charset=utf-8' });


        output.scrapedData!.initial = null;
        output.scrapedData!.DOM = null;
    } catch (e: any) {
        log.debug("Failed to create the diff of initial response and rendered document:");
        console.log(e.message);


    }


    // TODO: generate folder with a timestamp for each run 
    await KeyValueStore.setValue("OUTPUT", JSON.stringify(output!, null, 2), { contentType: 'application/json; charset=utf-8' });
    // const store = await Actor.openKeyValueStore(`runs/${dayjs(new Date()).format('YYYY-MM-DD_HH-mm-ss')}`);
    // YYYYmmddHHMMSS
    await store.setValue("OUTPUT", JSON.stringify(output!, null, 2), { contentType: 'application/json; charset=utf-8' });


    Actor.exit();
})();
