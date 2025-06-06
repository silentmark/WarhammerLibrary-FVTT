import { getActiveDocumentOwner } from "./utility";

/**
 * Shamelessly copied from dnd5e's spell template implementation
 * @augments {MeasuredTemplate}
 */
export default class AreaTemplate extends foundry.canvas.placeables.MeasuredTemplate
{

    /**
     * Track the timestamp when the last mouse move event was captured.
     * @type {number}
     */
    #moveTime = 0;

    /* -------------------------------------------- */

    /**
     * The initially active CanvasLayer to re-activate after the workflow is complete.
     * @type {CanvasLayer}
     */
    #initialLayer;

    /* -------------------------------------------- */

    /**
     * Track the bound event handlers so they can be properly canceled later.
     * @type {object}
     */
    #events;

    
    static fromString(aoeString, actorId, itemId, messageId, diameter=true) 
    {
        if (aoeString.toLowerCase().includes(game.i18n.localize("AoE").toLowerCase()))
        {aoeString = aoeString.substring(aoeString.indexOf("(")+1, aoeString.length-1);};
      
        // Prepare template data
        const templateData = {
            t: "circle",
            user: game.user.id,
            distance: diameter ? parseInt(aoeString) / 2 : parseInt(aoeString),
            direction: 0,
            x: 0,
            y: 0,
            fillColor: game.user.color,
            flags: {
                [game.system.id]: {
                    itemuuid: `Actor.${actorId}.Item.${itemId}`,
                    messageId: messageId,
                    round: game.combat?.round ?? -1,
                    target : true
                }
            }
        };
  
        const cls = CONFIG.MeasuredTemplate.documentClass;
        const template = new cls(templateData, {parent: canvas.scene});
  
        // Return the template constructed from the item data
        return new this(template);
    }

    static async fromEffect(effectUuid, messageId, radius, mergeData={}) 
    {

        let effect = await fromUuid(effectUuid);
        let effectData = effect.convertToApplied();
        // Sometimes, the radius needs to reference the test (usually overcasting)
        
        foundry.utils.setProperty(effectData, "system.sourceData.test",  game.messages.get(messageId)?.system.test);

        foundry.utils.mergeObject(effectData, mergeData);

        radius = radius || effect.radius; 

        // Prepare template data
        const templateData = {
            t: "circle",
            user: game.user.id,
            distance: radius,
            direction: 0,
            x: 0,
            y: 0,
            fillColor: game.user.color,
            flags: {
                [game.system.id]: {
                    effectData: effectData,
                    messageId: messageId,
                    aura: false,
                    round: game.combat?.round ?? -1,
                    instantaneous : effect.system.transferData.area.duration == "instantaneous"
                }
            }
        };

        const cls = CONFIG.MeasuredTemplate.documentClass;
        const template = new cls(templateData, {target: true, parent: canvas.scene });

        // Return the template constructed from the item data
        return new this(template);
    }
    /* -------------------------------------------- */

    
    static async fromAuraEffect(effectUuid, token) 
    {

        let effect = await fromUuid(effectUuid);
        let effectData = effect.convertToApplied();
        
        // Prepare template data
        const templateData = {
            t: "circle",
            user: game.user.id,
            distance: effect.radius,
            direction: 0,
            x: token.object.center.x,
            y: token.object.center.y,
            fillColor: effectData.system.transferData.area.templateData.fillColor || game.user.color,
            borderColor: effectData.system.transferData.area.templateData.borderColor || "#000000",
            texture: effectData.system.transferData.area.templateData.texture,
            hidden : !effectData.system.transferData.area.aura.render,
            flags: {
                [game.system.id]: {
                    effectData: effectData,
                    aura : {
                        owner : token.actor?.uuid,
                        transferred : effect.system.transferData.area.aura.transferred,
                        render: effect.system.transferData.area.aura.render
                    },
                    effectUuid : effectUuid,
                    instantaneous: false
                }
            }
        };

        const cls = CONFIG.MeasuredTemplate.documentClass;
        const template = new cls(templateData, {target: true, parent: canvas.scene });

        // Return the template constructed from the item data
        return new this(template);
    }

    /**
     * Creates a preview of the spell template.
     * @returns {Promise}  A promise that resolves with the final measured template if created.
     */
    drawPreview() 
    {
        const initialLayer = canvas.activeLayer;

        // Draw the template and switch to the template layer
        this.draw();
        this.layer.activate();
        this.layer.preview.addChild(this);

        // Hide the sheet that originated the preview
        this.actorSheet?.minimize();

        // Activate interactivity
        return this.activatePreviewListeners(initialLayer);
    }

    /* -------------------------------------------- */

    /**
     * Activate listeners for the template preview
     * @param {CanvasLayer} initialLayer  The initially active CanvasLayer to re-activate after the workflow is complete
     * @returns {Promise}                 A promise that resolves with the final measured template if created.
     */
    activatePreviewListeners(initialLayer) 
    {
        return new Promise((resolve, reject) => 
        {
            this.#initialLayer = initialLayer;
            this.#events = {
                cancel: this._onCancelPlacement.bind(this),
                confirm: this._onConfirmPlacement.bind(this),
                move: this._onMovePlacement.bind(this),
                resolve,
                reject,
                rotate: this._onRotatePlacement.bind(this)
            };

            // Activate listeners
            canvas.stage.on("mousemove", this.#events.move);
            canvas.stage.on("mousedown", this.#events.confirm);
            canvas.app.view.oncontextmenu = this.#events.cancel;
            canvas.app.view.onwheel = this.#events.rotate;
        });
    }

    /* -------------------------------------------- */

    /**
     * Shared code for when template placement ends by being confirmed or canceled.
     * @param {Event} event  Triggering event that ended the placement.
     */
    async _finishPlacement(event) 
    {
        this.layer._onDragLeftCancel(event);
        canvas.stage.off("mousemove", this.#events.move);
        canvas.stage.off("mousedown", this.#events.confirm);
        canvas.app.view.oncontextmenu = null;
        canvas.app.view.onwheel = null;
        this.#initialLayer.activate();
        await this.actorSheet?.maximize();
    }

    /* -------------------------------------------- */

    /**
     * Move the template preview when the mouse moves.
     * @param {Event} event  Triggering mouse event.
     */
    _onMovePlacement(event) 
    {
        event.stopPropagation();
        let now = Date.now(); // Apply a 20ms throttle
        if ( now - this.#moveTime <= 20 ) {return;}
        const center = event.data.getLocalPosition(this.layer);
        if (!canvas.grid.isGridless)
        {
            const snapped = canvas.grid.getSnappedPosition(center.x, center.y, 2);
            this.document.updateSource({x: snapped.x, y: snapped.y});
        }
        else 
        {
            this.document.updateSource({x: center.x, y: center.y});
        }
        this.refresh();
        this.#moveTime = now;
        if (this.document.getFlag(game.system.id, "target"))
        {
            this.updateAOETargets();
        }
    }

    /* -------------------------------------------- */

    /**
     * Rotate the template preview by 3˚ increments when the mouse wheel is rotated.
     * @param {Event} event  Triggering mouse event.
     */
    _onRotatePlacement(event) 
    {
        if ( event.ctrlKey ) {event.preventDefault();} // Avoid zooming the browser window
        event.stopPropagation();
        let delta = canvas.grid.type > CONST.GRID_TYPES.SQUARE ? 30 : 15;
        let snap = event.shiftKey ? delta : 5;
        const update = {direction: this.document.direction + (snap * Math.sign(event.deltaY))};
        this.document.updateSource(update);
        this.refresh();
    }

    /* -------------------------------------------- */

    /**
     * Confirm placement when the left mouse button is clicked.
     * @param {Event} event  Triggering mouse event.
     */
    async _onConfirmPlacement(event) 
    {
        await this._finishPlacement(event);
        const destination = canvas.grid.getSnappedPosition(this.document.x, this.document.y, 2);
        this.document.updateSource(destination);
        this.#events.resolve(canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [this.document.toObject()]).then(templates => 
        {
            let test = game.messages.get(templates[0].flags[game.system.id].messageId)?.system?.test;
            if (test && test.data.context.templates)
            {
                test.data.context.templates = test.data.context.templates.concat(templates[0].id);
                test.renderRollCard();
            }
        }));
    }

    /* -------------------------------------------- */

    /**
     * Cancel placement when the right mouse button is clicked.
     * @param {Event} event  Triggering mouse event.
     */
    async _onCancelPlacement(event) 
    {
        await this._finishPlacement(event);
        this.#events.reject();
    }

    updateAOETargets()
    {
        let grid = canvas.scene.grid;
        let templateGridSize = this.document.distance/grid.distance * grid.size;

        let minx = this.document.x - templateGridSize;
        let miny = this.document.y - templateGridSize;

        let maxx = this.document.x + templateGridSize;
        let maxy = this.document.y + templateGridSize;

        let newTokenTargets = [];
        canvas.tokens.placeables.forEach(t => 
        {
            if ((t.x + (t.width / 2)) < maxx && (t.x + (t.width / 2)) > minx && (t.y + (t.height / 2)) < maxy && (t.y + (t.height / 2)) > miny)
            {newTokenTargets.push(t.id);};
        });

        game.canvas.tokens.setTargets(newTokenTargets);

    }

}

