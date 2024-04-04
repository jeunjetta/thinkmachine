import React from "react";
import toast, { Toaster } from "react-hot-toast";
import slugify from "slugify";
import * as THREE from "three";

import ThinkMachineAPI from "@src/bridge";
import * as files from "@src/lib/files";
import { isUUID } from "@lib/uuid";

import Animation from "@lib/Animation";

import License from "@components/License";
import Console from "@components/Console";
import Filters from "@components/Filters";
import Settings from "@components/Settings";
import Interwingle from "@components/Interwingle";
import Depth from "@components/Depth";
import Footer from "@components/Footer";
import ForceGraph from "@components/ForceGraph";
import Typer from "@components/Typer";
import Wormhole from "@components/Wormhole.js";

export default class App extends React.Component {
    constructor(props) {
        super(props);
        this.inputRef = React.createRef();
        this.consoleRef = React.createRef();
        this.graphRef = React.createRef();
        this.depthRef = React.createRef();
        this.wormhole = new Wormhole();
        this.animation = new Animation(this.graphRef);
        this.state = {
            loaded: false,
            edited: false,
            error: null,

            showConsole: false,
            showLicense: false,
            showSettings: false,

            licenseKey: "",
            licenseValid: undefined,
            trialExpired: false,
            llm: {
                service: "openai",
                model: "gpt-4-turbo-preview",
            },
            width: window.innerWidth,
            height: window.innerHeight,

            graphType: window.localStorage.getItem("graphType") || "3d",
            controlType: window.localStorage.getItem("controlType") || "orbit",

            hideLabelsThreshold: 1000,
            hideLabels: true,
            wormholeMode: parseInt(
                window.localStorage.getItem("wormholeMode") || -1
            ),
            isAnimating: false,
            isShiftDown: false,
            isGenerating: false,

            reloads: 0,
            interwingle: 3,
            input: "",
            inputMode: "add",
            hyperedge: [],
            hyperedges: [],
            filters: [],
            depth: 0,
            maxDepth: 0,
            data: { nodes: [], links: [] },
            lastReloadedDate: new Date(),
        };
    }

    reloadData(controlType = null, zoom = true) {
        return new Promise(async (resolve, reject) => {
            const start = Date.now();

            const data = await window.api.forceGraph.graphData(
                this.state.filters,
                {
                    interwingle: this.state.interwingle,
                    depth: this.state.depth,
                }
            );

            let depth = this.state.depth;
            const maxDepth = data.maxDepth || 0;
            if (depth > maxDepth) depth = maxDepth;

            const hyperedges = await window.api.hyperedges.all();

            let edited = this.state.edited;
            if (hyperedges.length > 0) {
                edited = true;
            }

            const state = {
                data,
                depth,
                maxDepth,
                loaded: true,
                reloads: this.state.reloads + 1,
                hyperedges,
                edited,
                lastReloadedDate: new Date(),
                hideLabels: data.nodes.length >= this.state.hideLabelsThreshold,
            };

            if (controlType) {
                state.controlType = controlType;
            }

            const elapsed = Date.now() - start;
            console.log(`reloaded data in ${elapsed}ms`);

            this.setState(state, async () => {
                if (zoom) {
                    setTimeout(() => {
                        this.graphRef.current.zoomToFit(300, 100);
                        resolve();
                    }, 250);
                } else {
                    resolve();
                }
            });
        });
    }

    componentDidMount() {
        ForceGraph.load(this.graphRef, this.state.graphType);

        document.addEventListener("keydown", this.handleKeyDown.bind(this));
        document.addEventListener("keyup", this.handleKeyUp.bind(this));
        document.addEventListener("mousedown", this.handleMouseDown.bind(this));
        document.addEventListener("mouseup", this.handleMouseUp.bind(this));
        document.addEventListener("wheel", this.handleZoom.bind(this));
        window.addEventListener("resize", this.handleResize.bind(this));

        ThinkMachineAPI.load().then(async () => {
            this.loadSettings();

            await this.reloadData();

            window.api.analytics.track("app.load");

            await this.handleAutoSearch();
        });
    }

    componentWillUnmount() {
        this.animation.stop();
        document.removeEventListener("keydown", this.handleKeyDown.bind(this));
        document.removeEventListener("keyup", this.handleKeyUp.bind(this));
        document.removeEventListener(
            "mousedown",
            this.handleMouseDown.bind(this)
        );
        document.removeEventListener("mouseup", this.handleMouseUp.bind(this));
        document.removeEventListener("wheel", this.handleZoom.bind(this));
        window.removeEventListener("resize", this.handleResize.bind(this));
    }

    async loadSettings() {
        try {
            const data = window.localStorage.getItem("llm");
            if (data) {
                const llm = JSON.parse(data);
                this.setState({ llm });
            }
        } catch (e) {
            console.error(e);
        }
    }

    async handleAutoSearch() {
        if (!this.state.loaded) return;
        if (this.state.hyperedges.length > 0) return;
        if (this.state.input.length > 0) return;
        if (this.state.edited) return;
        if (this.state.inputMode !== "generate") return;

        const prompt = decodeURIComponent(
            window.location.pathname.substring(1)
        );

        if (!prompt) return;
        if (prompt.trim().length === 0) return;
        if (isUUID(prompt)) return;

        console.log("AUTO SEARCH", prompt);

        this.setState({ input: prompt }, async () => {
            this.handleGenerateInput();
            window.history.replaceState(
                {},
                document.title,
                window.location.pathname
            );
        });
    }

    async fetchLicenseInfo() {
        // return;
        // const license = await window.api.licenses.info();
        // this.setState(license, async () => {
        //     await this.validateAccess();
        // });
    }

    maybeReloadData(duration = 1000) {
        const now = new Date();
        const elapsed = now - this.state.lastReloadedDate;
        if (elapsed > duration) {
            this.reloadData();
        }
    }

    get isFocusingInput() {
        return document.activeElement == this.inputRef.current;
    }

    get uniqueSymbols() {
        const symbols = new Set();
        for (const hyperedge of this.state.hyperedges) {
            for (const symbol of hyperedge) {
                symbols.add(symbol);
            }
        }

        return Array.from(symbols);
    }

    handleResize() {
        this.setState({
            width: window.innerWidth,
            height: window.innerHeight,
        });
    }

    handleZoom() {
        this.animation.pause();
        this.animation.resume();
    }

    handleMouseDown(e) {
        this.animation.interact();
    }

    handleMouseUp(e) {
        this.animation.stopInteracting();
    }

    handleKeyDown(e) {
        this.animation.interact();

        if (e.key === "Shift") {
            this.setState({ isShiftDown: true });
        }

        if (e.key === "1" && e.metaKey) {
            this.setState({ inputMode: "add" });
        } else if (e.key === "2" && e.metaKey) {
            this.setState({ inputMode: "generate" });
        } else if (e.key === "3" && e.metaKey) {
            this.setState({ inputMode: "search" });
        } else if (e.key === "Tab") {
            this.toggleInterwingle();
        } else if (e.key === "`") {
            this.setState({ showConsole: !this.state.showConsole });
        } else if (e.key === "-" && !this.isFocusingInput) {
            this.zoom(5);
        } else if (e.key === "=" && !this.isFocusingInput) {
            this.zoom(-5);
        } else if (e.key === "+" && !this.isFocusingInput) {
            this.zoom(-50);
        } else if (e.key === "_" && !this.isFocusingInput) {
            this.zoom(50);
        } else if (e.key === "ArrowLeft") {
            if (this.state.graphType === "3d") {
                this.rotate(-1);
            } else {
                this.panX(-1);
            }
        } else if (e.key === "ArrowRight") {
            if (this.state.graphType === "3d") {
                this.rotate(1);
            } else {
                this.panX(1);
            }
        } else if (e.key === "ArrowDown") {
            if (this.state.graphType === "2d") {
                this.panY(1);
            }
            // this.toggleDepth(this.state.depth - 1);
        } else if (e.key === "ArrowUp") {
            if (this.state.graphType === "2d") {
                this.panY(-1);
            }
            // this.toggleDepth(this.state.depth + 1);
        } else if (e.key === "Backspace") {
            if (this.state.input === "") {
                this.setState({ hyperedge: this.state.hyperedge.slice(0, -1) });
            } else {
                this.inputReference.focus();
            }
        } else if (this.state.controlType === "fly") {
            return;
        } else if (
            (this.state.trialExpired && !this.state.licenseValid) ||
            this.state.showLicense ||
            this.state.showSettings
        ) {
            return;
        } else {
            if (e.key !== "Shift") {
                this.inputReference.focus();
            }
        }
    }

    get inputReference() {
        if (!this.inputRef) return {};
        if (!this.inputRef.current) return {};
        if (!this.inputRef.current.firstChild) return {}; // so hacky...but we grab the parent because downshift takes over reference
        const reference = this.inputRef.current.firstChild;
        return reference;
    }

    handleKeyUp(e) {
        this.animation.stopInteracting();

        if (e.key === "Shift") {
            this.setState({ isShiftDown: false });
        }
    }

    async createNewHypergraph() {
        try {
            const uuid = await window.api.hypergraph.create();

            if (!(await window.api.hypergraph.isValid())) {
                throw new Error("Hypergraph was not initialized properly");
            }

            window.history.pushState(
                { urlPath: `/${uuid}` },
                document.title,
                `/${uuid}`
            );

            return uuid;
        } catch (e) {
            console.log("error creating new hypergraph", e);
            return null;
        }
    }

    async handleEmptyHypergraph() {
        if (!(await window.api.hypergraph.isValid())) {
            await this.createNewHypergraph();
        }
    }

    async handleInput(e) {
        e.preventDefault();

        if (this.state.inputMode === "add") {
            await this.handleAddInput(e);
        } else if (this.state.inputMode === "generate") {
            if (this.state.input.trim().length === 0) {
                toast.error("Please enter a phrase");
                return;
            }

            await this.handleGenerateInput(e);
        } else if (this.state.inputMode === "search") {
            if (this.state.input.trim().length === 0) {
                toast.error("Please enter a search term");
                return;
            }

            await this.handleSearchInput(e);
        }
    }

    async handleGenerateInput(e) {
        await this.handleEmptyHypergraph();

        const llm = this.state.llm;
        const options = { llm };
        const response = await window.api.hyperedges.generate(
            this.state.input,
            options
        );

        for await (const message of response) {
            switch (message.event) {
                case "hyperedges.generate.result":
                    this.maybeReloadData();
                    break;
                case "hyperedges.generate.start":
                    this.setState({ isGenerating: true, edited: true });
                    break;
                case "hyperedges.generate.stop":
                    this.setState({ isGenerating: false });
                    this.reloadData();
                    break;
                case "success":
                    toast.success(
                        message.message || "Successfully generated results"
                    );
                    break;
                case "error":
                    toast.error(message.message || "Error generating results");
                    break;
                default:
                    console.log("UNKNOWN MESSAGE", message);
                    break;
            }
        }
    }

    async handleSearchInput(e) {
        await this.handleEmptyHypergraph();
        this.searchText(this.state.input, this.state.isShiftDown);
    }

    async handleAddInput(e) {
        await this.handleEmptyHypergraph();

        if (this.state.input.trim().length === 0) {
            this.setState({
                input: "",
                hyperedge: [],
            });
            return;
        }
        await window.api.hyperedges.add(this.state.hyperedge, this.state.input);

        this.setState(
            {
                input: "",
                edited: true,
                hyperedge: [...this.state.hyperedge, this.state.input],
            },
            async () => {
                await this.reloadData();
            }
        );
    }

    handleClickNode(node, e) {
        window.api.analytics.track("app.clickNode");
        this.searchText(node.name, e.shiftKey);
    }

    searchText(text, append = false) {
        const filters = this.state.filters;
        if (append) {
            if (filters.length === 0) {
                filters.push([]);
            }

            filters[filters.length - 1].push(text);
        } else {
            filters.push([text]);
        }

        this.setState({ filters }, () => {
            this.reloadData();
        });
    }

    // this doesn't really work
    zoom(amount = 0) {
        const cameraPosition = this.graphRef.current.cameraPosition();
        this.graphRef.current.cameraPosition({ z: cameraPosition.z + amount });
    }

    // this doesn't really work
    rotate(angleDegrees) {
        const cameraPosition = this.graphRef.current.cameraPosition();

        const distance = Math.sqrt(
            cameraPosition.x ** 2 + cameraPosition.z ** 2
        );

        const initialAngle = Math.atan2(cameraPosition.x, cameraPosition.z);

        const rotationRadians = angleDegrees * (Math.PI / 180);
        const newAngle = initialAngle + rotationRadians;

        const x = distance * Math.sin(newAngle);
        const z = distance * Math.cos(newAngle);

        this.graphRef.current.cameraPosition(
            { x, y: cameraPosition.y, z },
            null,
            100
        );
    }

    panX(amount) {
        if (this.state.isShiftDown) amount *= 10;
        const position = this.graphRef.current.centerAt();
        this.graphRef.current.centerAt(position.x + amount, undefined, 100);
    }

    panY(amount) {
        if (this.state.isShiftDown) amount *= 10;
        const position = this.graphRef.current.centerAt();
        this.graphRef.current.centerAt(undefined, position.y + amount, 100);
    }

    toggleLabels() {
        window.api.analytics.track("app.toggleLabels");
        this.setState({ hideLabels: !this.state.hideLabels }, () => {
            this.graphRef.current.refresh();
        });
    }

    toggleCamera() {
        window.api.analytics.track("app.toggleCamera");
        const controlType =
            this.state.controlType === "orbit" ? "fly" : "orbit";

        window.localStorage.setItem("controlType", controlType);

        // reload page, unfortunately 3D Force Graph doesn't allow dynamic control type changes
        window.location.href = window.location.href;
    }

    toggleGraphType() {
        window.api.analytics.track("app.toggleGraphType");
        const graphType = this.state.graphType === "2d" ? "3d" : "2d";

        window.localStorage.setItem("graphType", graphType);
        window.location.href = window.location.href;
    }

    toggleAnimation() {
        window.api.analytics.track("app.toggleAnimation");
        if (this.state.isAnimating) {
            this.animation.stop();
        } else {
            this.animation.start();
        }

        this.setState({ isAnimating: !this.state.isAnimating });
    }

    toggleInterwingle(interwingle) {
        window.api.analytics.track("app.toggleInterwingle");
        if (typeof interwingle === "undefined") {
            interwingle = this.state.interwingle;
            interwingle++;
        }

        if (interwingle > 3) interwingle = 0;

        this.setState({ interwingle }, () => {
            this.reloadData();
        });
    }

    toggleDepth(depth) {
        window.api.analytics.track("app.toggleDepth");
        if (typeof depth === "undefined") {
            depth = this.state.depth;
            depth++;
        }

        if (depth > this.state.maxDepth) depth = this.state.maxDepth;
        if (depth < 0) depth = 0;

        this.setState({ depth }, () => {
            setTimeout(() => {
                if (this.depthRef.current) {
                    this.depthRef.current.blur();
                }
            }, 50);

            this.reloadData();
        });
    }

    toggleWormhole() {
        window.api.analytics.track("app.toggleWormhole");

        let wormholeMode;
        if (this.state.wormholeMode > -1) {
            wormholeMode = -1;
        } else {
            wormholeMode = 0;
        }

        this.setState({ wormholeMode, controlType: "fly" });
        window.localStorage.setItem("wormholeMode", wormholeMode);
        window.localStorage.setItem("controlType", "fly");

        // reload page, unfortunately 3D Force Graph doesn't allow dynamic control type changes
        window.location.href = window.location.href;
    }

    startWormhole() {
        if (this.state.wormholeMode !== 0) return;

        this.setState({ wormholeMode: 1, controlType: "fly" }, () => {
            this.wormhole.setup();
            this.setState({ wormholeMode: 2, controlType: "fly" }, () => {
                this.resetCameraPosition();
            });
        });
    }

    stopWormhole() {
        if (this.state.wormholeMode === 0) return;
        this.setState({ wormholeMode: 0, controlType: "fly" }, () => {
            this.wormhole.teardown();
        });
    }

    resetCameraPosition() {
        if (!this.graphRef || !this.graphRef.current) return;
        this.graphRef.current.cameraPosition({
            x: -500,
            y: 0,
            z: 100,
        });
    }

    removeIndexFromHyperedge(index) {
        const hyperedge = this.state.hyperedge;
        hyperedge.splice(index, 1);
        this.setState({ hyperedge });
    }

    removeFilterSymbol(filter, symbol) {
        window.api.analytics.track("app.removeFilterSymbol");
        const filters = this.state.filters;
        const indexOf = filters.indexOf(filter);
        filter.splice(filter.indexOf(symbol), 1);
        if (filter.length === 0) {
            filters.splice(indexOf, 1);
        } else {
            filters[indexOf] = filter;
        }
        this.setState({ filters }, () => {
            this.reloadData();
        });
    }

    async removeHyperedge(hyperedge) {
        await window.api.hyperedges.remove(hyperedge);
        await this.reloadData();
    }

    async validateAccess() {
        // const state = {
        //     licenseValid: false,
        //     trialExpired: this.state.trialRemaining <= 0,
        // };
        // if (this.state.licenseKey) {
        //     state.licenseValid = await window.api.licenses.validate(
        //         this.state.licenseKey
        //     );
        //     if (state.licenseValid) {
        //         await window.api.settings.set("license", this.state.licenseKey);
        //         state.error = null;
        //     } else {
        //         state.error = "License is not valid";
        //     }
        // }
        // this.setState(state);
    }

    async activateLicense(e) {
        e.preventDefault();
        await this.validateAccess();
    }

    async deactivateLicense() {
        // await window.api.settings.set("license", null);
        // await window.api.settings.set("lastValidated", null);
        this.setState({ licenseKey: "", licenseValid: false }, async () => {
            await this.fetchLicenseInfo();
        });
    }

    async updateLLM(llm) {
        this.setState({ llm }, async () => {
            await this.updateSettings();
        });
    }

    async updateSettings() {
        const llm = this.state.llm;
        window.localStorage.setItem("llm", JSON.stringify(llm));
    }

    async createThinkMachineTutorial() {
        if (this.state.hyperedges.length > 0) return;

        const tutorial = [
            ["Think Machine", "mind mapping", "3D visualization"],
            ["Think Machine", "brainstorming", "idea exploration"],
            ["Think Machine", "knowledge graph", "information connections"],
            ["mind mapping", "complex information", "visualization"],
            ["mind mapping", "hierarchical structure", "limitations"],
            ["brainstorming", "research", "idea exploration"],
            ["knowledge graph", "hidden connections", "discovery"],
            ["Think Machine", "students", "visual learning"],
            ["Think Machine", "researchers", "complex data analysis"],
            ["Think Machine", "project managers", "project roadmap"],
            ["Think Machine", "writers", "narrative development"],
            ["Think Machine", "entrepreneurs", "strategy planning"],
            ["Think Machine", "teachers", "immersive learning"],
            ["Think Machine", "designers", "information architecture"],
            ["Think Machine", "marketers", "customer journey visualization"],
            [
                "Think Machine",
                "healthcare professionals",
                "medical data visualization",
            ],
            ["Think Machine", "AI integration", "knowledge graph generation"],
            ["knowledge graph", "data addition", "simple process"],
            [
                "Think Machine",
                "search functionality",
                "context-based exploration",
            ],
            ["complex ideas", "visualization", "Think Machine"],
            ["information research", "exploration", "Think Machine"],
            ["idea brainstorming", "connection discovery", "Think Machine"],
            ["Think Machine", "local application", "privacy"],
            ["Think Machine", "cross-platform compatibility", "open-source"],
        ];

        for (const hyperedge of tutorial) {
            const last = hyperedge.pop();
            await window.api.hyperedges.add(hyperedge, last);
        }
        this.setState({ interwingle: 3, depth: -1 }, async () => {
            await this.reloadData();
        });
    }

    // Function to check for collisions
    checkForCollisions() {
        if (this.state.wormholeMode === -1) return;
        if (this.state.wormholeMode === 2) return; // generating wormhole already

        const collisionThreshold = 40; // Distance at which we consider a collision to occur

        const camera = this.graphRef.current.camera();
        const cameraPosition = new THREE.Vector3();
        cameraPosition.setFromMatrixPosition(camera.matrixWorld); // Get the camera's position

        for (let node of this.state.data.nodes) {
            const nodePosition = new THREE.Vector3(node.x, node.y, node.z); // Assuming nodes have x, y, z properties
            const distance = cameraPosition.distanceTo(nodePosition); // Calculate distance from camera to node

            if (distance < collisionThreshold) {
                const hyperedges = node._meta.hyperedgeIDs;
                this.generateWormhole(hyperedges);
            }
        }
    }

    async generateWormhole(hyperedges) {
        this.startWormhole();

        const from = window.api.uuid.get();
        await this.createNewHypergraph();

        try {
            await window.api.hyperedges.wormhole(hyperedges, {
                llm: this.state.llm,
                from,
            });
        } catch (e) {
            console.log(e);
            console.log("ERROR", e);
        } finally {
            await this.reloadData();
            this.stopWormhole();
        }
    }

    handleTick() {
        this.checkForCollisions();
    }

    async handleDownload() {
        const data = await window.api.hyperedges.export();

        const name = slugify(
            `thinkmachine ${this.state.hyperedges[0].join(" ")} ${Date.now()}`
        );

        await files.saveFile(data, `${name}.csv`, "text/csv");
    }

    render() {
        return (
            <div>
                <div className="absolute inset-0 z-50 pointer-events-none">
                    <Toaster
                        position="bottom-center"
                        containerStyle={{ zIndex: 60 }}
                        toastOptions={{
                            style: {
                                background: "#000",
                                color: "#fff",
                            },
                        }}
                    />
                </div>
                <License
                    licenseKey={this.state.licenseKey}
                    licenseValid={this.state.licenseValid}
                    trialExpired={this.state.trialExpired}
                    trialRemaining={this.state.trialRemaining}
                    showLicense={this.state.showLicense}
                    activateLicense={this.activateLicense.bind(this)}
                    deactivateLicense={this.deactivateLicense.bind(this)}
                    error={this.state.error}
                    updateLicenseKey={(licenseKey) =>
                        this.setState({ licenseKey })
                    }
                    closeLicense={() => this.setState({ showLicense: false })}
                />
                <Console
                    consoleRef={this.consoleRef}
                    showConsole={this.state.showConsole}
                    hyperedges={this.state.hyperedges}
                    removeHyperedge={this.removeHyperedge.bind(this)}
                />
                <Filters
                    filters={this.state.filters}
                    removeFilter={this.removeFilterSymbol.bind(this)}
                />
                <Interwingle
                    interwingle={this.state.interwingle}
                    toggleInterwingle={this.toggleInterwingle.bind(this)}
                    show={this.state.isAnimating === false && this.state.edited}
                />
                <Depth
                    depthRef={this.depthRef}
                    depth={this.state.depth}
                    maxDepth={this.state.maxDepth}
                    show={this.state.isAnimating === false && this.state.edited}
                    toggleDepth={this.toggleDepth.bind(this)}
                />
                <Typer
                    inputRef={this.inputRef}
                    input={this.state.input}
                    inputMode={this.state.inputMode}
                    setInputMode={(inputMode) => this.setState({ inputMode })}
                    isGenerating={this.state.isGenerating}
                    loaded={this.state.loaded}
                    handleCreateTutorial={this.createThinkMachineTutorial.bind(
                        this
                    )}
                    hyperedges={this.state.hyperedges}
                    symbols={this.uniqueSymbols}
                    handleInput={this.handleInput.bind(this)}
                    removeIndex={this.removeIndexFromHyperedge.bind(this)}
                    changeInput={(input) => {
                        this.setState({ input });
                    }}
                    hyperedge={this.state.hyperedge}
                    show={!this.state.showConsole && !this.state.isAnimating}
                    edited={this.state.edited}
                />
                <ForceGraph
                    graphType={this.state.graphType}
                    graphRef={this.graphRef}
                    onTick={this.handleTick.bind(this)}
                    data={this.state.data}
                    width={this.state.width}
                    height={this.state.height}
                    controlType={this.state.controlType}
                    hideLabels={this.state.hideLabels}
                    onNodeClick={this.handleClickNode.bind(this)}
                    showLabels={!this.state.hideLabels}
                />
                <Settings
                    showSettings={this.state.showSettings}
                    updateLLM={this.updateLLM.bind(this)}
                    llm={this.state.llm}
                    closeSettings={() => this.setState({ showSettings: false })}
                />
                <Footer
                    isAnimating={this.state.isAnimating}
                    controlType={this.state.controlType}
                    graphType={this.state.graphType}
                    toggleCamera={this.toggleCamera.bind(this)}
                    toggleAnimation={this.toggleAnimation.bind(this)}
                    toggleGraphType={this.toggleGraphType.bind(this)}
                    loaded={this.state.loaded}
                    edited={this.state.edited}
                    handleDownload={this.handleDownload.bind(this)}
                    hyperedges={this.state.hyperedges}
                    wormholeMode={this.state.wormholeMode}
                    toggleWormhole={this.toggleWormhole.bind(this)}
                    toggleSettings={() =>
                        this.setState({
                            showSettings: !this.state.showSettings,
                        })
                    }
                />
            </div>
        );
    }
}
