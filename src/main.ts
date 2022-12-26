import Apify from 'apify';
import { normalizeArray } from './helpers/normalize';
import { PlaywrightScraper } from "./scraper/PlaywrightScraper";
import { Input, Output } from "../src/types";
import { searchData } from './search/Search';
import { Validator } from './validation/Validator';
import { readFileSync, writeFileSync } from "fs";

const { log } = Apify.utils;
/**
 * Actor's entry point. 
 */
Apify.main(async () => {


    if (process.env.NODE_ENV != "production") {
        // Copy input from input examples
        const inputFile = "./src/static/example_inputs/INPUT_AMIUNIQUE.json"
        
        await Apify.setValue("INPUT", readFileSync(inputFile), { contentType: "application/json; charset=utf-8" })
    }



    // Structure of the input is defined in /INPUT_SCHEMA.json.
    // This function expects INPUT.json file in the key-value storage
    const input = await Apify.getInput() as Input;
    // copy frontent application to keyvalue store, this file is generated by project analyzer-ui, mentioned in the readme.
    // on Apify platform, this file is copied during building in docker
    await Apify.setValue("DASHBOARD", readFileSync("./src/static/index.html"), { contentType: 'text/html; charset=utf-8' });

    log.info("INPUT", input);
    log.setLevel(log.LEVELS.DEBUG);
    log.info('===================================================================================================================');
    log.info('Welcome to the page analyzer!');
    log.info('URL: ' + input.url);
    log.info('KEYWORDS: ' + input.keywords);
    log.info('===================================================================================================================');

    const normalizedKeywords = normalizeArray(input.keywords);
    const scraper = new PlaywrightScraper(input.url, normalizedKeywords);

    const output = new Output(input.url, normalizedKeywords);
    output.analysisStarted = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    const validator = new Validator();

    // TODO: implement multiple retries 
    try {
        // navigate to the website, scrape and parse the data 
        const scrapedData = await scraper.scrapePage(false, true);

        // after the browser is closed, search the data 
        const searchResults = searchData(scrapedData, normalizedKeywords);

        // retrieve initial responses by cheeriocrawler and 
        // validate search results against it
        const validatedData = await validator.validate(input.url, normalizedKeywords, searchResults);

        // save the output
        output.scrapedData = scrapedData;
        output.searchResults = searchResults;
        output.keywordConclusions = validatedData.conclusion;
        output.xhrValidated = validatedData.xhrValidated;

    } catch (e: any) {

        // TODO: proper error handling
        log.error('Top lever error inside main:');
        log.error(e.message);
        console.error(e);
        output.actorSuccess = false;
        output.errorMessage = e.message;

    }
    output.analysisEnded = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    await Apify.setValue("OUTPUT", JSON.stringify(output!, null, 2), { contentType: 'application/json; charset=utf-8' });
    writeFileSync("../analyzer-ui/public/OUTPUT", JSON.stringify(output!, null, 2));


});
