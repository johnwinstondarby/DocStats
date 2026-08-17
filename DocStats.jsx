#target "InDesign"
#targetengine "DocStats"

/*
    DocStats.jsx
    Adobe InDesign document statistics, health, and output-readiness scanner.

    Version: 1.1.0

    Scopes:
      - Document
      - Print/PDF
      - EPUB

    Design principles:
      - Findings identify a findable location whenever InDesign exposes one.
      - Severity communicates operational priority: ERROR, WARNING, INFO.
      - Locate selects the affected object and pages to it when possible.
      - Automated actions are limited to narrow, reversible or user-confirmed changes.
      - Scanning itself is read-only.

    Compatibility:
      ExtendScript / ECMAScript 3 for Adobe InDesign.
*/

(function () {
    var VERSION = "1.1.0";
    var MIN_PRINT_PPI = 200;

    if (app.documents.length === 0) {
        alert("DocStats\n\nOpen an InDesign document and run the script again.");
        return;
    }

    var doc = app.activeDocument;
    var state = {
        stats: null,
        findings: [],
        filtered: [],
        scope: "ALL",
        scannedAt: null
    };

    function safeLength(obj, fallback) {
        try {
            if (obj === undefined || obj === null) return fallback || 0;
            return obj.length;
        } catch (e) {
            return fallback || 0;
        }
    }

    function safeString(value) {
        try {
            if (value === undefined || value === null) return "";
            return String(value);
        } catch (e) {
            return "";
        }
    }

    function trim(value) {
        return safeString(value).replace(/^\s+|\s+$/g, "");
    }

    function pad2(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function timestamp(d) {
        return d.getFullYear() + "-" +
            pad2(d.getMonth() + 1) + "-" +
            pad2(d.getDate()) + " " +
            pad2(d.getHours()) + ":" +
            pad2(d.getMinutes()) + ":" +
            pad2(d.getSeconds());
    }

    function fileTimestamp(d) {
        return d.getFullYear() +
            pad2(d.getMonth() + 1) +
            pad2(d.getDate()) + "-" +
            pad2(d.getHours()) +
            pad2(d.getMinutes()) +
            pad2(d.getSeconds());
    }

    function fmt(n) {
        var s = safeString(n);
        var out = "";
        var i;
        var count = 0;
        for (i = s.length - 1; i >= 0; i--) {
            out = s.charAt(i) + out;
            count++;
            if (count % 3 === 0 && i !== 0) out = "," + out;
        }
        return out;
    }

    function yesNo(v) {
        return v ? "Yes" : "No";
    }

    function ctorName(obj) {
        if (!obj) return "";
        try {
            if (obj.constructor && obj.constructor.name) return obj.constructor.name;
        } catch (e1) {}
        try {
            if (obj.constructorName) return obj.constructorName;
        } catch (e2) {}
        return "";
    }

    function pageName(page) {
        try {
            if (page && page.isValid) return safeString(page.name);
        } catch (e) {}
        return "";
    }

    function pageFromText(textObj) {
        try {
            if (textObj.parentTextFrames && textObj.parentTextFrames.length > 0) {
                var frame = textObj.parentTextFrames[0];
                if (frame && frame.isValid && frame.parentPage && frame.parentPage.isValid) {
                    return frame.parentPage;
                }
            }
        } catch (e) {}
        return null;
    }

    function pageOf(obj) {
        if (!obj) return null;

        try {
            if (obj.parentPage && obj.parentPage.isValid) return obj.parentPage;
        } catch (e1) {}

        var textPage = pageFromText(obj);
        if (textPage) return textPage;

        var current = obj;
        var depth;
        for (depth = 0; depth < 12; depth++) {
            try {
                if (current.parentPage && current.parentPage.isValid) return current.parentPage;
            } catch (e2) {}

            textPage = pageFromText(current);
            if (textPage) return textPage;

            try {
                if (!current.parent || current.parent === current) break;
                current = current.parent;
            } catch (e3) {
                break;
            }
        }
        return null;
    }

    function pageItemOf(obj) {
        if (!obj) return null;
        var current = obj;
        var depth;
        for (depth = 0; depth < 10; depth++) {
            try {
                if (current.parentPage !== undefined && current.select !== undefined) {
                    return current;
                }
            } catch (e1) {}
            try {
                if (!current.parent || current.parent === current) break;
                current = current.parent;
            } catch (e2) {
                break;
            }
        }
        return null;
    }

    function locationFor(obj, fallback) {
        var page = pageOf(obj);
        var pageText = pageName(page);
        if (pageText) return "Page " + pageText;
        return fallback || "Document";
    }

    function minPpi(value) {
        var n = 0;
        try {
            if (value instanceof Array) {
                if (value.length === 0) return 0;
                n = Number(value[0]);
                if (value.length > 1 && Number(value[1]) < n) n = Number(value[1]);
                return n;
            }
        } catch (e1) {}
        n = Number(value);
        return isNaN(n) ? 0 : n;
    }

    function csvEscape(value) {
        var s = safeString(value).replace(/\r\n|\r|\n/g, " ");
        if (s.indexOf('"') >= 0) s = s.replace(/"/g, '""');
        if (/[",]/.test(s)) s = '"' + s + '"';
        return s;
    }

    function severityRank(value) {
        if (value === "ERROR") return 0;
        if (value === "WARNING") return 1;
        return 2;
    }

    function addFinding(severity, scope, code, title, detail, target, actionLabel, actionFn) {
        var page = pageOf(target);
        state.findings.push({
            severity: severity,
            scope: scope,
            code: code,
            title: title,
            detail: detail,
            target: target || null,
            page: page,
            pageName: pageName(page),
            location: locationFor(target, "Document"),
            actionLabel: actionLabel || "",
            actionFn: actionFn || null
        });
    }

    function scopeMatches(finding, scope) {
        if (scope === "ALL") return true;
        return finding.scope === scope;
    }

    function filteredFindings(scope) {
        var out = [];
        var i;
        for (i = 0; i < state.findings.length; i++) {
            if (scopeMatches(state.findings[i], scope)) out.push(state.findings[i]);
        }
        out.sort(function (a, b) {
            var sa = severityRank(a.severity);
            var sb = severityRank(b.severity);
            if (sa !== sb) return sa - sb;
            var pa = a.pageName === "" ? 999999 : Number(a.pageName);
            var pb = b.pageName === "" ? 999999 : Number(b.pageName);
            if (!isNaN(pa) && !isNaN(pb) && pa !== pb) return pa - pb;
            return a.code < b.code ? -1 : (a.code > b.code ? 1 : 0);
        });
        return out;
    }

    function lastStoryContainer(story) {
        try {
            var containers = story.textContainers;
            if (containers && containers.length > 0) return containers[containers.length - 1];
        } catch (e) {}
        return story;
    }

    function effectiveAltText(pageItem) {
        try {
            if (pageItem && pageItem.objectExportOptions) {
                return trim(pageItem.objectExportOptions.altText());
            }
        } catch (e1) {}
        try {
            if (pageItem && pageItem.objectExportOptions) {
                return trim(pageItem.objectExportOptions.customAltText);
            }
        } catch (e2) {}
        return "";
    }

    function isAnchored(pageItem) {
        if (!pageItem) return false;
        try {
            var parentType = ctorName(pageItem.parent);
            if (parentType === "Character") return true;
        } catch (e1) {}
        try {
            if (pageItem.anchoredObjectSettings && pageItem.anchoredObjectSettings.isValid) {
                var p = pageItem.parent;
                if (ctorName(p) === "Character") return true;
            }
        } catch (e2) {}
        return false;
    }

    function setCustomAltText(pageItem) {
        if (!pageItem || !pageItem.objectExportOptions) return false;
        var existing = effectiveAltText(pageItem);
        var value = prompt("EPUB alternate text for " + locationFor(pageItem, "selected object") + ":", existing);
        if (value === null) return false;
        value = trim(value);
        if (!value) {
            alert("DocStats\n\nAlternate text was left empty. No change was made.");
            return false;
        }
        try {
            pageItem.objectExportOptions.customAltText = value;
            try {
                pageItem.objectExportOptions.altTextSourceType = SourceType.SOURCE_CUSTOM;
            } catch (eSource) {}
            return true;
        } catch (e) {
            alert("DocStats could not set alternate text.\n\n" + e);
            return false;
        }
    }

    function setMetadataField(fieldName, label) {
        var prefs = doc.metadataPreferences;
        var existing = "";
        try { existing = safeString(prefs[fieldName]); } catch (e1) {}
        var value = prompt(label + ":", existing);
        if (value === null) return false;
        value = trim(value);
        if (!value) return false;
        try {
            prefs[fieldName] = value;
            return true;
        } catch (e2) {
            alert("DocStats could not update document metadata.\n\n" + e2);
            return false;
        }
    }

    function updateLink(link) {
        try {
            if (!confirm("Update linked asset?\n\n" + safeString(link.name))) return false;
            link.update();
            return true;
        } catch (e) {
            alert("DocStats could not update the link.\n\n" + e);
            return false;
        }
    }

    function relinkAsset(link) {
        var replacement = File.openDialog("Choose replacement for " + safeString(link.name));
        if (!replacement) return false;
        try {
            link.relink(replacement);
            try { link.update(); } catch (eUpdate) {}
            return true;
        } catch (e) {
            alert("DocStats could not relink the asset.\n\n" + e);
            return false;
        }
    }

    function setFirstHeaderRow(table) {
        try {
            if (!confirm("Set the first row of this table as a header row?\n\nReview the table after this change.")) return false;
            table.headerRowCount = 1;
            return true;
        } catch (e) {
            alert("DocStats could not set the table header row.\n\n" + e);
            return false;
        }
    }

    function locateFinding(finding) {
        if (!finding) return;

        try {
            if (finding.page && finding.page.isValid && app.activeWindow) {
                app.activeWindow.activePage = finding.page;
            }
        } catch (ePage) {}

        var target = finding.target;
        if (!target) return;

        try {
            if (ctorName(target) === "Link" && target.show) {
                target.show();
                return;
            }
        } catch (eShow) {}

        try {
            var item = pageItemOf(target);
            if (item && item.isValid) {
                app.select(item);
                try { app.activeWindow.zoom(ZoomOptions.FIT_SELECTION); } catch (eZoom) {}
                return;
            }
        } catch (eSelectItem) {}

        try {
            app.select(target);
            try { app.activeWindow.zoom(ZoomOptions.FIT_SELECTION); } catch (eZoom2) {}
        } catch (eSelect) {}
    }

    function scanDocument() {
        state.findings = [];
        state.scannedAt = new Date();

        var stats = {
            pages: safeLength(doc.pages),
            spreads: safeLength(doc.spreads),
            layers: safeLength(doc.layers),
            stories: safeLength(doc.stories),
            textFrames: safeLength(doc.textFrames),
            threadedTextFrames: 0,
            standaloneTextFrames: 0,
            words: 0,
            characters: 0,
            paragraphs: 0,
            lines: 0,
            tables: 0,
            footnotes: 0,
            endnotes: 0,
            oversetStories: 0,
            graphics: 0,
            links: safeLength(doc.links),
            normalLinks: 0,
            embeddedLinks: 0,
            missingLinks: 0,
            outOfDateLinks: 0,
            inaccessibleLinks: 0,
            otherLinkStatus: 0,
            fonts: safeLength(doc.fonts),
            missingFonts: 0,
            paragraphStyles: 0,
            characterStyles: 0,
            objectStyles: 0,
            tableStyles: 0,
            cellStyles: 0,
            hyperlinks: safeLength(doc.hyperlinks),
            crossReferences: safeLength(doc.crossReferenceSources),
            bookmarks: safeLength(doc.bookmarks),
            articles: 0
        };

        var i;

        // Text-frame threading.
        for (i = 0; i < stats.textFrames; i++) {
            try {
                var tf = doc.textFrames[i];
                var hasPrev = false;
                var hasNext = false;
                try { hasPrev = (tf.previousTextFrame !== null && tf.previousTextFrame.isValid); } catch (ePrev) {}
                try { hasNext = (tf.nextTextFrame !== null && tf.nextTextFrame.isValid); } catch (eNext) {}
                if (hasPrev || hasNext) stats.threadedTextFrames++;
                else stats.standaloneTextFrames++;
            } catch (eTF) {}
        }

        // Stories, text statistics, overset, and EPUB table headers.
        for (i = 0; i < stats.stories; i++) {
            try {
                var story = doc.stories[i];
                try { stats.words += safeLength(story.words); } catch (eW) {}
                try { stats.characters += safeLength(story.characters); } catch (eC) {}
                try { stats.paragraphs += safeLength(story.paragraphs); } catch (eP) {}
                try { stats.lines += safeLength(story.lines); } catch (eL) {}
                try { stats.footnotes += safeLength(story.footnotes); } catch (eF) {}
                try { stats.endnotes += safeLength(story.endnotes); } catch (eE) {}

                var overflow = false;
                try { overflow = story.overflows; } catch (eOverflow) {
                    try {
                        var endContainer = lastStoryContainer(story);
                        overflow = !!endContainer.overflows;
                    } catch (eOverflow2) {}
                }
                if (overflow) {
                    stats.oversetStories++;
                    var overflowTarget = lastStoryContainer(story);
                    addFinding(
                        "ERROR",
                        "DOCUMENT",
                        "DOC-001",
                        "Overset text",
                        "A story contains text that is not currently composed into a visible text frame. Export can omit the hidden text.",
                        overflowTarget
                    );
                }

                try {
                    var storyTables = story.tables;
                    var t;
                    for (t = 0; t < storyTables.length; t++) {
                        var table = storyTables[t];
                        stats.tables++;
                        try {
                            if (table.bodyRowCount > 0 && table.columnCount > 0 && table.headerRowCount === 0) {
                                (function (capturedTable) {
                                    addFinding(
                                        "WARNING",
                                        "EPUB",
                                        "EPUB-004",
                                        "Table has no header row",
                                        "The table has body rows but no designated header row. Header semantics improve navigation and interpretation in accessible output.",
                                        capturedTable,
                                        "Set first row as header",
                                        function () { return setFirstHeaderRow(capturedTable); }
                                    );
                                })(table);
                            }
                        } catch (eHeader) {}
                    }
                } catch (eTables) {}
            } catch (eStory) {}
        }

        // Graphics and links.
        try { stats.graphics = safeLength(doc.allGraphics); } catch (eGraphics) {}

        for (i = 0; i < stats.links; i++) {
            try {
                var link = doc.links[i];
                var status = link.status;

                if (status === LinkStatus.LINK_MISSING) {
                    stats.missingLinks++;
                    (function (capturedLink) {
                        addFinding(
                            "ERROR",
                            "DOCUMENT",
                            "DOC-002",
                            "Missing linked asset: " + safeString(capturedLink.name),
                            "The placed asset cannot be found at its recorded location.",
                            capturedLink,
                            "Relink...",
                            function () { return relinkAsset(capturedLink); }
                        );
                    })(link);
                } else if (status === LinkStatus.LINK_OUT_OF_DATE) {
                    stats.outOfDateLinks++;
                    (function (capturedLink2) {
                        addFinding(
                            "WARNING",
                            "DOCUMENT",
                            "DOC-003",
                            "Out-of-date linked asset: " + safeString(capturedLink2.name),
                            "A newer version of the linked file exists on disk.",
                            capturedLink2,
                            "Update link",
                            function () { return updateLink(capturedLink2); }
                        );
                    })(link);
                } else if (status === LinkStatus.LINK_INACCESSIBLE) {
                    stats.inaccessibleLinks++;
                    addFinding(
                        "ERROR",
                        "DOCUMENT",
                        "DOC-004",
                        "Inaccessible linked asset: " + safeString(link.name),
                        "InDesign reports that the URL-based link is inaccessible.",
                        link
                    );
                } else if (status === LinkStatus.LINK_EMBEDDED) {
                    stats.embeddedLinks++;
                } else if (status === LinkStatus.NORMAL) {
                    stats.normalLinks++;
                } else {
                    stats.otherLinkStatus++;
                    addFinding(
                        "INFO",
                        "DOCUMENT",
                        "DOC-005",
                        "Unrecognized link status: " + safeString(link.name),
                        "InDesign returned a link status outside the common normal, missing, out-of-date, inaccessible, and embedded states.",
                        link
                    );
                }
            } catch (eLink) {
                stats.otherLinkStatus++;
            }
        }

        // Fonts.
        for (i = 0; i < stats.fonts; i++) {
            try {
                var font = doc.fonts[i];
                if (font.status !== FontStatus.INSTALLED) {
                    stats.missingFonts++;
                    addFinding(
                        "ERROR",
                        "DOCUMENT",
                        "DOC-006",
                        "Font unavailable: " + safeString(font.name),
                        "The document references a font that InDesign does not report as installed and available. Location is document-wide because the font object does not expose a direct page reference.",
                        null
                    );
                }
            } catch (eFont) {}
        }

        // Style counts.
        try { stats.paragraphStyles = safeLength(doc.allParagraphStyles); } catch (ePS) {}
        try { stats.characterStyles = safeLength(doc.allCharacterStyles); } catch (eCS) {}
        try { stats.objectStyles = safeLength(doc.allObjectStyles); } catch (eOS) {}
        try { stats.tableStyles = safeLength(doc.allTableStyles); } catch (eTS) {}
        try { stats.cellStyles = safeLength(doc.allCellStyles); } catch (eCell) {}
        try { stats.articles = safeLength(doc.articles); } catch (eArticles) {}

        // Print/PDF image resolution and EPUB image checks.
        var allGraphics = [];
        try { allGraphics = doc.allGraphics; } catch (eAllGraphics) { allGraphics = []; }

        for (i = 0; i < safeLength(allGraphics); i++) {
            try {
                var graphic = allGraphics[i];
                var typeName = ctorName(graphic);
                var container = pageItemOf(graphic);

                if (typeName === "Image") {
                    try {
                        var effective = minPpi(graphic.effectivePpi);
                        if (effective > 0 && effective < MIN_PRINT_PPI) {
                            addFinding(
                                "WARNING",
                                "PRINT/PDF",
                                "PRINT-001",
                                "Low effective image resolution: " + Math.round(effective) + " PPI",
                                "The bitmap image is below the DocStats advisory threshold of " + MIN_PRINT_PPI + " effective PPI. Required resolution depends on output process, line screen, and viewing distance.",
                                graphic
                            );
                        }
                    } catch (ePpi) {}
                }

                if (container) {
                    var altText = effectiveAltText(container);
                    if (!altText) {
                        (function (capturedContainer) {
                            addFinding(
                                "WARNING",
                                "EPUB",
                                "EPUB-001",
                                "Graphic has no resolved alternate text",
                                "No alternate text is currently resolved from the object's export options. Decorative graphics can be intentional exceptions and require manual review.",
                                capturedContainer,
                                "Set alt text...",
                                function () { return setCustomAltText(capturedContainer); }
                            );
                        })(container);
                    }

                    if (!isAnchored(container)) {
                        addFinding(
                            "INFO",
                            "EPUB",
                            "EPUB-002",
                            "Graphic is not anchored in text",
                            "Unanchored page objects depend on EPUB export mode and reading-order settings. Review placement for reflowable EPUB output.",
                            container
                        );
                    }
                }
            } catch (eGraphic) {}
        }

        // EPUB document metadata.
        try {
            if (!trim(doc.metadataPreferences.documentTitle)) {
                addFinding(
                    "WARNING",
                    "EPUB",
                    "EPUB-005",
                    "Document title metadata is empty",
                    "EPUB output should carry a meaningful publication title in document metadata.",
                    null,
                    "Set title...",
                    function () { return setMetadataField("documentTitle", "Document title"); }
                );
            }
        } catch (eTitle) {}

        try {
            if (!trim(doc.metadataPreferences.author)) {
                addFinding(
                    "INFO",
                    "EPUB",
                    "EPUB-006",
                    "Document author metadata is empty",
                    "Author metadata is empty and should be reviewed before EPUB distribution.",
                    null,
                    "Set author...",
                    function () { return setMetadataField("author", "Author"); }
                );
            }
        } catch (eAuthor) {}

        // Article panel / reading-order signal.
        try {
            if (safeLength(doc.articles) === 0 && stats.graphics > 0) {
                addFinding(
                    "INFO",
                    "EPUB",
                    "EPUB-003",
                    "No Articles panel reading order is defined",
                    "The document contains graphics but no Articles panel entries. Reflowable EPUB reading order should be reviewed against the chosen export settings.",
                    null
                );
            }
        } catch (eArticleCheck) {}

        // Empty-document informational signal.
        if (stats.pages === 0) {
            addFinding(
                "WARNING",
                "DOCUMENT",
                "DOC-007",
                "Document has no pages",
                "No document pages are present.",
                null
            );
        }

        state.stats = stats;
        return stats;
    }

    function reportLines(scope) {
        var s = state.stats;
        var findings = filteredFindings(scope);
        var lines = [];
        var i;

        lines.push("DOCSTATS - INDESIGN DOCUMENT REPORT");
        lines.push("=================================");
        lines.push("DocStats version: " + VERSION);
        lines.push("Document: " + doc.name);
        lines.push("Generated: " + timestamp(state.scannedAt || new Date()));
        lines.push("Scope: " + scope);
        lines.push("Saved: " + yesNo(doc.saved));
        lines.push("Modified since last save: " + yesNo(doc.modified));
        try { if (doc.saved) lines.push("Path: " + doc.fullName.fsName); } catch (ePath) {}

        lines.push("");
        lines.push("DOCUMENT STRUCTURE");
        lines.push("------------------");
        lines.push("Pages: " + fmt(s.pages));
        lines.push("Spreads: " + fmt(s.spreads));
        lines.push("Layers: " + fmt(s.layers));
        lines.push("Stories: " + fmt(s.stories));
        lines.push("Text frames: " + fmt(s.textFrames));
        lines.push("Threaded text frames: " + fmt(s.threadedTextFrames));
        lines.push("Standalone text frames: " + fmt(s.standaloneTextFrames));

        lines.push("");
        lines.push("TEXT");
        lines.push("----");
        lines.push("Words: " + fmt(s.words));
        lines.push("Characters: " + fmt(s.characters));
        lines.push("Paragraphs: " + fmt(s.paragraphs));
        lines.push("Composed lines: " + fmt(s.lines));
        lines.push("Tables: " + fmt(s.tables));
        lines.push("Footnotes: " + fmt(s.footnotes));
        lines.push("Endnotes: " + fmt(s.endnotes));
        lines.push("Overset stories: " + fmt(s.oversetStories));

        lines.push("");
        lines.push("GRAPHICS AND LINKS");
        lines.push("------------------");
        lines.push("Graphics: " + fmt(s.graphics));
        lines.push("Links: " + fmt(s.links));
        lines.push("Normal links: " + fmt(s.normalLinks));
        lines.push("Embedded links: " + fmt(s.embeddedLinks));
        lines.push("Missing links: " + fmt(s.missingLinks));
        lines.push("Out-of-date links: " + fmt(s.outOfDateLinks));
        lines.push("Inaccessible URL links: " + fmt(s.inaccessibleLinks));
        lines.push("Other/unknown link status: " + fmt(s.otherLinkStatus));

        lines.push("");
        lines.push("FONTS AND STYLES");
        lines.push("----------------");
        lines.push("Fonts used: " + fmt(s.fonts));
        lines.push("Fonts unavailable: " + fmt(s.missingFonts));
        lines.push("Paragraph styles: " + fmt(s.paragraphStyles));
        lines.push("Character styles: " + fmt(s.characterStyles));
        lines.push("Object styles: " + fmt(s.objectStyles));
        lines.push("Table styles: " + fmt(s.tableStyles));
        lines.push("Cell styles: " + fmt(s.cellStyles));

        lines.push("");
        lines.push("NAVIGATION / INTERACTIVE");
        lines.push("------------------------");
        lines.push("Hyperlinks: " + fmt(s.hyperlinks));
        lines.push("Cross-reference sources: " + fmt(s.crossReferences));
        lines.push("Bookmarks: " + fmt(s.bookmarks));
        lines.push("Articles: " + fmt(s.articles));

        lines.push("");
        lines.push("FINDINGS");
        lines.push("--------");
        if (findings.length === 0) {
            lines.push("No findings in the selected scope.");
        } else {
            for (i = 0; i < findings.length; i++) {
                var f = findings[i];
                lines.push(
                    "[" + f.severity + "] [" + f.scope + "] " + f.code +
                    " | " + f.location + " | " + f.title
                );
                lines.push("  " + f.detail);
                if (f.actionLabel) lines.push("  Available action: " + f.actionLabel);
            }
        }

        lines.push("");
        lines.push("Notes:");
        lines.push("- Scan operations are read-only.");
        lines.push("- Actions run only after explicit user selection; destructive or ambiguous remediation is intentionally excluded.");
        lines.push("- Locate uses the page and selection InDesign exposes for the affected object.");
        lines.push("- The " + MIN_PRINT_PPI + " PPI image threshold is advisory and can be changed in the script constant MIN_PRINT_PPI.");
        lines.push("- EPUB findings are pre-export review signals; export intent and accessibility decisions still require editorial judgment.");

        return lines;
    }

    function saveTextReport(scope) {
        var now = state.scannedAt || new Date();
        var baseName = doc.name.replace(/\.[^\.]+$/, "");
        var suggestedName = baseName + "_DocStats_" + fileTimestamp(now) + ".txt";
        var defaultFile;
        try {
            defaultFile = doc.saved ? File(doc.filePath.fsName + "/" + suggestedName) : File(Folder.desktop.fsName + "/" + suggestedName);
        } catch (eDefault) {
            defaultFile = File(Folder.desktop.fsName + "/" + suggestedName);
        }
        var outFile = defaultFile.saveDlg("Save DocStats report", "Text Files:*.txt");
        if (!outFile) return;
        try {
            outFile.encoding = "UTF-8";
            outFile.lineFeed = "Windows";
            if (!outFile.open("w")) throw new Error("Could not open selected file for writing.");
            outFile.write(reportLines(scope).join("\r"));
            outFile.close();
            alert("DocStats report saved:\n\n" + outFile.fsName);
        } catch (e) {
            try { if (outFile.opened) outFile.close(); } catch (eClose) {}
            alert("DocStats could not save the report.\n\n" + e);
        }
    }

    function saveCsv(scope) {
        var findings = filteredFindings(scope);
        var now = state.scannedAt || new Date();
        var baseName = doc.name.replace(/\.[^\.]+$/, "");
        var suggestedName = baseName + "_DocStats_Findings_" + fileTimestamp(now) + ".csv";
        var defaultFile;
        try {
            defaultFile = doc.saved ? File(doc.filePath.fsName + "/" + suggestedName) : File(Folder.desktop.fsName + "/" + suggestedName);
        } catch (eDefault) {
            defaultFile = File(Folder.desktop.fsName + "/" + suggestedName);
        }
        var outFile = defaultFile.saveDlg("Save DocStats findings", "CSV Files:*.csv");
        if (!outFile) return;
        try {
            outFile.encoding = "UTF-8";
            outFile.lineFeed = "Windows";
            if (!outFile.open("w")) throw new Error("Could not open selected file for writing.");
            outFile.writeln("Severity,Scope,Code,Page,Location,Finding,Detail,Action");
            var i;
            for (i = 0; i < findings.length; i++) {
                var f = findings[i];
                outFile.writeln([
                    csvEscape(f.severity),
                    csvEscape(f.scope),
                    csvEscape(f.code),
                    csvEscape(f.pageName),
                    csvEscape(f.location),
                    csvEscape(f.title),
                    csvEscape(f.detail),
                    csvEscape(f.actionLabel)
                ].join(","));
            }
            outFile.close();
            alert("DocStats findings CSV saved:\n\n" + outFile.fsName);
        } catch (e) {
            try { if (outFile.opened) outFile.close(); } catch (eClose) {}
            alert("DocStats could not save the CSV.\n\n" + e);
        }
    }

    // ------------------------------------------------------------
    // ScriptUI palette
    // ------------------------------------------------------------

    scanDocument();

    var win = new Window("palette", "DocStats " + VERSION + " - " + doc.name, undefined, {resizeable: true});
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = 8;
    win.margins = 12;

    var controls = win.add("group");
    controls.orientation = "row";
    controls.alignChildren = ["left", "center"];
    controls.add("statictext", undefined, "Scope:");
    var scopeList = controls.add("dropdownlist", undefined, ["All", "Document", "Print/PDF", "EPUB"]);
    scopeList.selection = 0;

    var scanButton = controls.add("button", undefined, "Scan");
    var saveButton = controls.add("button", undefined, "Save report...");
    var csvButton = controls.add("button", undefined, "Save CSV...");

    var summary = win.add("statictext", undefined, "", {multiline: false});

    var list = win.add("listbox", undefined, "", {
        multiselect: false,
        numberOfColumns: 5,
        showHeaders: true,
        columnTitles: ["Severity", "Scope", "Page", "Code", "Finding"],
        columnWidths: [70, 80, 55, 75, 430]
    });
    list.preferredSize = [760, 330];

    var detailPanel = win.add("panel", undefined, "Finding detail");
    detailPanel.orientation = "column";
    detailPanel.alignChildren = ["fill", "top"];
    var detail = detailPanel.add("edittext", undefined, "Select a finding.", {multiline: true, scrolling: true, readonly: true});
    detail.preferredSize = [740, 105];

    var actionRow = detailPanel.add("group");
    actionRow.orientation = "row";
    actionRow.alignment = "right";
    var locateButton = actionRow.add("button", undefined, "Locate");
    var actionButton = actionRow.add("button", undefined, "Action");
    var closeButton = actionRow.add("button", undefined, "Close");
    locateButton.enabled = false;
    actionButton.enabled = false;

    function selectedScope() {
        if (!scopeList.selection) return "ALL";
        var label = scopeList.selection.text;
        if (label === "All") return "ALL";
        if (label === "Document") return "DOCUMENT";
        if (label === "Print/PDF") return "PRINT/PDF";
        return "EPUB";
    }

    function currentFinding() {
        if (!list.selection) return null;
        var idx = list.selection.index;
        if (idx < 0 || idx >= state.filtered.length) return null;
        return state.filtered[idx];
    }

    function updateDetail() {
        var f = currentFinding();
        if (!f) {
            detail.text = "Select a finding.";
            locateButton.enabled = false;
            actionButton.enabled = false;
            actionButton.text = "Action";
            return;
        }
        detail.text =
            f.severity + " | " + f.scope + " | " + f.code + "\r" +
            f.location + "\r\r" +
            f.title + "\r" +
            f.detail;
        locateButton.enabled = !!f.target;
        actionButton.enabled = !!f.actionFn;
        actionButton.text = f.actionLabel ? f.actionLabel : "Action";
    }

    function refreshList() {
        state.scope = selectedScope();
        state.filtered = filteredFindings(state.scope);
        list.removeAll();

        var errors = 0;
        var warnings = 0;
        var infos = 0;
        var i;

        for (i = 0; i < state.filtered.length; i++) {
            var f = state.filtered[i];
            if (f.severity === "ERROR") errors++;
            else if (f.severity === "WARNING") warnings++;
            else infos++;

            var item = list.add("item", f.severity);
            item.subItems[0].text = f.scope;
            item.subItems[1].text = f.pageName || "-";
            item.subItems[2].text = f.code;
            item.subItems[3].text = f.title;
        }

        summary.text =
            "Pages " + fmt(state.stats.pages) +
            " | Stories " + fmt(state.stats.stories) +
            " | Links " + fmt(state.stats.links) +
            " | Findings " + fmt(state.filtered.length) +
            " (" + errors + " error, " + warnings + " warning, " + infos + " info)";

        updateDetail();
    }

    scopeList.onChange = refreshList;
    list.onChange = updateDetail;

    scanButton.onClick = function () {
        scanDocument();
        refreshList();
    };

    saveButton.onClick = function () {
        saveTextReport(selectedScope());
    };

    csvButton.onClick = function () {
        saveCsv(selectedScope());
    };

    locateButton.onClick = function () {
        locateFinding(currentFinding());
    };

    actionButton.onClick = function () {
        var f = currentFinding();
        if (!f || !f.actionFn) return;
        var changed = false;
        try { changed = !!f.actionFn(); } catch (e) { alert("DocStats action failed.\n\n" + e); }
        if (changed) {
            scanDocument();
            refreshList();
        }
    };

    closeButton.onClick = function () {
        win.close();
    };

    win.onResizing = win.onResize = function () {
        this.layout.resize();
    };

    refreshList();
    win.center();
    win.show();
})();
