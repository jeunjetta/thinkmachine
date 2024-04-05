import { v4 as uuid } from "uuid";

import * as middleware from "./middleware.js"
import Hypergraph from "./models/hypergraph.js";

export default class WebBridge {
    constructor(app) {
        this.app = app;
    }

    handle(route, handler) {
        this.app.post(route, async (req, res) => {
            if (!req.guid) { return res.json({ ok: false, error: "invalid guid" }); }
            if (!req.uuid) { return res.json({ ok: false, error: "invalid uuid" }); }

            let data;

            if (handler.constructor.name === "AsyncFunction") {
                data = await handler(req.bridge, req.body, req, res);
            } else {
                data = handler(req.bridge, req.body, req, res);
            }

            await req.event(route, JSON.stringify(req.body));
            return res.json({ ok: true, data });
        });
    }

    async load() {
        this.app.use(middleware.user);
        this.app.use(middleware.event);
        this.app.use(middleware.thinkmachine);
        this.app.use(middleware.bridge);

        this.app.post("/api/user/create", async (req, res) => {
            let guid = req.signedCookies.guid;
            if (!guid) {
                guid = uuid();

                req.guid = guid;

                res.cookie("guid", guid, {
                    signed: true,
                    expires: new Date(Date.now() + 900000),
                });

                await req.event("user.create");
            }

            return res.json({ ok: true, data: guid });
        });

        this.handle("/api/hypergraph/graphData", (bridge, { filter, options }) => {
            return bridge.graphData(filter, options);
        });

        this.handle("/api/hypergraph/create", async (_, body, req) => {
            return await this.createHypergraph(req);
        });

        this.handle("/api/hyperedges/all", (bridge) => {
            return bridge.allHyperedges();
        });

        this.handle("/api/hyperedges/add", (bridge, { hyperedge, symbol }) => {
            return bridge.addHyperedges(hyperedge, symbol);
        });

        this.handle("/api/hyperedges/remove", (bridge, { hyperedge }) => {
            return bridge.removeHyperedges(hyperedge);
        });

        this.handle("/api/analytics/track", (bridge, { event }) => {
            return bridge.trackAnalytics(event);
        });
    }

    async createHypergraph(req) {
        req.uuid = uuid();
        await Hypergraph.create({ id: req.uuid, guid: req.guid });
        return req.uuid;
    }

    static async initialize(app) {
        const bridge = new WebBridge(app);
        await bridge.load();
        return bridge;
    }
}

/*
// import Analytics from "./analytics.js"
import debug from "debug";
const log = debug("thinkmachine:server:bridge");

// import colors from "../common/lib/colors.js";
import extractor from "./extractor.js";
import Event from "./models/event.js";
import { isUUID, isEmptyUUID } from "./utils.js";

export default class WebBridge {
    constructor(app) {
        this.app = app;
        this.app.post("/api/hypergraph/create", this.createHypergraph.bind(this));
        this.app.post("/api/forceGraph/graphData", this.graphData.bind(this));
        this.app.post("/api/hyperedges/add", this.addHyperedges.bind(this));
        this.app.post("/api/hyperedges/remove", this.removeHyperedges.bind(this));
        this.app.post("/api/hyperedges/generate", this.generateHyperedges.bind(this));
        this.app.post("/api/hyperedges/export", this.exportHyperedges.bind(this));
        this.app.post("/api/hyperedges/wormhole", this.generateWormhole.bind(this));
        this.app.post("/api/analytics/track", this.trackAnalytics.bind(this));
    }

    trackAnalytics(req, res) {
        // const { event, properties } = req.body;
        // Analytics.track(event, properties);
        res.send({ ok: true });
    }

    async addHyperedges(req, res) {
        const { hyperedge, symbol } = req.body;

        let edge = req.thinkabletype.get(...hyperedge);
        if (edge) {
            edge.add(symbol);
        } else {
            edge = req.thinkabletype.add(...hyperedge, symbol);
        }

        await req.thinkabletype.save();

        await req.sendEvent("hyperedges.add", JSON.stringify({ hyperedge, symbol }));

        return res.json({
            ok: true,
            data: edge.id
        });
    }

    async removeHyperedges(req, res) {
        const { hyperedge } = req.body;
        // Analytics.track("hyperedges.remove");

        req.thinkabletype.remove(...hyperedge);
        await req.thinkabletype.save();

        await req.sendEvent("hyperedges.remove", JSON.stringify({ hyperedge }));

        return res.json({
            ok: true,
        });
    }

    async generateHyperedges(req, res) {
        // Analytics.track("hyperedges.generate");

        async function send(message) {
            res.write("data: " + JSON.stringify(message) + "\n\n");
        }

        let { input, llm } = req.body;
        if (!llm) {
            return res.json({ ok: false, error: "missing llm" });
        }


        const options = {
            service: llm.service,
            model: llm.model,
        };

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('X-Accel-Buffering', 'no');


        await send({ event: "hyperedges.generate.start" });

        if (input.startsWith("http")) {

            await send({ event: "success", message: "Scraping URL..." });

            try {
                const data = await extractor(input);
                await send({ event: "success", message: "Scraped URL!" });
                input = data;
            } catch (e) {
                console.log("ERROR", e);
                await send({ event: "error", message: "Couldn't scrape URL" });
                throw e;
            }
        }

        await req.sendEvent("hyperedges.generate", JSON.stringify({ input, options }));

        await send({ event: "success", message: "Generating..." });

        try {
            const response = await req.thinkabletype.generate(input, options);

            for await (const hyperedges of response) {
                req.thinkabletype.addHyperedges(hyperedges);
                await req.thinkabletype.save();

                for (const hyperedge of hyperedges) {
                    await send({ event: "hyperedges.generate.result", hyperedge });
                }
            }

            if (req.thinkabletype.hyperedges.length > 0) {
                await send({ event: "success", message: "Generated knowledge graph" });
            }

        } catch (e) {
            console.log("ERROR", e);
            await send({ event: "error", message: "Error while generating" });
        } finally {
            await send({ event: "hyperedges.generate.stop" });
        }
    }

    // TODO: migrate to shared service code
    async generateWormhole(req, res) {
        const { hyperedges, llm, from } = req.body;

        if (!llm) {
            return res.json({ ok: false, error: "missing llm" });
        }

        if (!hyperedges || !Array.isArray(hyperedges)) {
            return res.json({ ok: false, error: "missing hyperedges" });
        }

        if (!from || !isUUID(from)) {
            return res.json({ ok: false, error: "missing from" });
        }

        const thinkmachine = await WebBridge.thinkableTypeForUUID(from);
        if (!thinkmachine) {
            return res.json({ ok: false, error: "invalid from" });
        }

        const options = {
            service: llm.service,
            model: llm.model,
        };

        const edges = [];
        for (const h of thinkmachine.hyperedges) {
            const id = h.id.replace(/^\d+:/, "");
            if (hyperedges.includes(id)) {
                edges.push(h);
            }
        }

        const input = edges.map((edge) => edge.symbols.join(" ")).join("\n");

        if (!input || input.length === 0) {
            return res.json({ ok: false, error: "missing input" });
        }

        await req.sendEvent("hyperedges.wormhole", JSON.stringify({ input, options }));

        const response = await req.thinkabletype.generate(input, options);

        for await (const hyperedges of response) {
            req.thinkabletype.addHyperedges(hyperedges);
        }

        await req.thinkabletype.save();

        return res.json({
            ok: true,
            data: ""
        });
    }


    async exportHyperedges(req, res) {
        const data = req.thinkabletype.export();

        await req.sendEvent("hyperedges.export");

        return res.json({
            ok: true,
            data,
        });
    }


    static async thinkableTypeForUUID(uuid) {
        let hypergraph = await Hypergraph.findByPk(uuid);

        if (!hypergraph) {
            try {
                hypergraph = await Hypergraph.create({ id: uuid });
            } catch (e) {
                // race condition...try to fetch it again
                if (e.name === "SequelizeUniqueConstraintError") {
                    hypergraph = await Hypergraph.findByPk(uuid);
                }
            }
        }

        const thinkabletype = new ThinkableType({});
        thinkabletype.parse(hypergraph.data);

        thinkabletype.save = async () => {
            const hypergraph = await Hypergraph.findByPk(uuid);
            hypergraph.data = thinkabletype.export();
            await hypergraph.save();
        };

        return thinkabletype;
    }

}
*/