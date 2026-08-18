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

    // Output-readiness profiles. General Health preserves the v1.1.0
    // 200-PPI advisory threshold. Print Production uses a stricter 300-PPI
    // advisory threshold. EPUB does not apply the print effective-PPI check.
    var PROFILES = {
        GENERAL: { key: "GENERAL", name: "General Health", minEffectivePpi: 200 },
        PRINT: { key: "PRINT", name: "Print Production", minEffectivePpi: 300 },
        EPUB: { key: "EPUB", name: "EPUB", minEffectivePpi: 0 }
    };
    var DEFAULT_PROFILE_KEY = "GENERAL";

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
        profileKey: DEFAULT_PROFILE_KEY,
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


    function profileFor(key) {
        if (key && PROFILES[key]) return PROFILES[key];
        return PROFILES[DEFAULT_PROFILE_KEY];
    }

    function safeId(obj) {
        try {
            if (obj && obj.isValid !== false && obj.id !== undefined) return safeString(obj.id);
        } catch (e) {}
        return "";
    }

    function formatBoundValue(value) {
        var n = Number(value);
        if (!isNaN(n)) return String(Math.round(n * 100) / 100);
        return safeString(value);
    }

    function geometricBoundsFor(obj) {
        var item = pageItemOf(obj) || textFrameOf(obj) || obj;
        try {
            var b = item.geometricBounds;
            if (b && b.length === 4) {
                return "[" + formatBoundValue(b[0]) + ", " + formatBoundValue(b[1]) + ", " +
                    formatBoundValue(b[2]) + ", " + formatBoundValue(b[3]) + "]";
            }
        } catch (e) {}
        return "";
    }

    function frameLabelNameFor(obj) {
        var item = pageItemOf(obj) || textFrameOf(obj) || obj;
        var label = "";
        var name = "";
        try { label = trim(item.label); } catch (e1) {}
        try { name = trim(item.name); } catch (e2) {}
        if (label && name && label !== name) return label + " / " + name;
        return label || name;
    }

    function textFrameOf(obj) {
        if (!obj) return null;
        try {
            if (ctorName(obj) === "TextFrame") return obj;
        } catch (e0) {}
        try {
            if (obj.parentTextFrames && obj.parentTextFrames.length > 0) return obj.parentTextFrames[0];
        } catch (e1) {}
        var current = obj;
        var depth;
        for (depth = 0; depth < 12; depth++) {
            try {
                if (ctorName(current) === "TextFrame") return current;
            } catch (e2) {}
            try {
                if (current.parentTextFrames && current.parentTextFrames.length > 0) return current.parentTextFrames[0];
            } catch (e3) {}
            try {
                if (!current.parent || current.parent === current) break;
                current = current.parent;
            } catch (e4) {
                break;
            }
        }
        return null;
    }

    function storyFrameIdFor(obj) {
        var frame = textFrameOf(obj);
        var storyId = "";
        var frameId = "";
        if (frame) {
            frameId = safeId(frame);
            try { storyId = safeId(frame.parentStory); } catch (e1) {}
        } else {
            try { storyId = safeId(obj.parentStory); } catch (e2) {}
        }
        if (storyId && frameId) return "Story " + storyId + " / Frame " + frameId;
        if (storyId) return "Story " + storyId;
        if (frameId) return "Frame " + frameId;
        return "";
    }

    function linkFileNameFor(obj) {
        if (!obj) return "";
        try {
            if (ctorName(obj) === "Link") return safeString(obj.name);
        } catch (e0) {}
        try {
            if (obj.itemLink && obj.itemLink.isValid) return safeString(obj.itemLink.name);
        } catch (e1) {}
        var item = pageItemOf(obj) || textFrameOf(obj) || obj;
        try {
            if (item.allGraphics && item.allGraphics.length > 0) {
                var g = item.allGraphics[0];
                if (g.itemLink && g.itemLink.isValid) return safeString(g.itemLink.name);
            }
        } catch (e2) {}
        try {
            if (obj.parent && obj.parent.itemLink && obj.parent.itemLink.isValid) return safeString(obj.parent.itemLink.name);
        } catch (e3) {}
        return "";
    }

    function objectMetadataFor(obj) {
        var item = pageItemOf(obj) || textFrameOf(obj) || obj;
        return {
            objectId: safeId(item),
            objectType: ctorName(item) || ctorName(obj),
            linkFileName: linkFileNameFor(obj),
            frameLabelName: frameLabelNameFor(obj),
            geometricBounds: geometricBoundsFor(obj),
            storyFrameId: storyFrameIdFor(obj)
        };
    }

    function oneLineText(value, maxLen) {
        var s = trim(safeString(value).replace(/\r\n|\r|\n|\t/g, " ").replace(/\s+/g, " "));
        if (maxLen && s.length > maxLen) s = s.substring(0, maxLen - 3) + "...";
        return s;
    }

    function incrementCount(map, key) {
        if (!key) key = "Unknown";
        if (map[key] === undefined) map[key] = 0;
        map[key]++;
    }

    function inlinePageItemFromText(text) {
        if (!text) return null;
        var contents = "";
        try { contents = safeString(text.contents); } catch (eContents) {}
        var compact = contents.replace(/\s+/g, "");
        if (!compact || compact.replace(/\uFFFC/g, "") !== "") return null;
        try {
            if (text.allPageItems && text.allPageItems.length > 0) return text.allPageItems[0];
        } catch (eAll) {}
        try {
            var chars = text.characters;
            var i;
            for (i = 0; i < chars.length; i++) {
                try {
                    if (chars[i].allPageItems && chars[i].allPageItems.length > 0) {
                        return chars[i].allPageItems[0];
                    }
                } catch (eChar) {}
            }
        } catch (eChars) {}
        return null;
    }

    function hyperlinkScheme(direction, category, destination) {
        if (direction === "INTERNAL") return "internal";
        if (category === "External document page") return "file";
        var value = trim(destination);
        var match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(value);
        if (match && match[1]) return safeString(match[1]).toLowerCase();
        if (direction === "EXTERNAL") return "other";
        return "unknown";
    }

    function hyperlinkDomain(scheme, destination) {
        var value = trim(destination);
        var host = "";
        if (scheme === "http" || scheme === "https" || scheme === "ftp") {
            value = value.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, "");
            host = value.split(/[\/?#]/)[0];
            if (host.indexOf("@") >= 0) host = host.substring(host.lastIndexOf("@") + 1);
            if (host.charAt(0) === "[") {
                var close = host.indexOf("]");
                if (close >= 0) host = host.substring(0, close + 1);
            } else if (host.indexOf(":") >= 0) {
                host = host.split(":")[0];
            }
        } else if (scheme === "mailto") {
            value = value.replace(/^mailto:/i, "").split(/[?]/)[0];
            if (value.indexOf("@") >= 0) host = value.substring(value.lastIndexOf("@") + 1);
        }
        host = safeString(host).toLowerCase();
        if (host.indexOf("www.") === 0) host = host.substring(4);
        return host;
    }

    function looksLikeRawUrlSource(sourceText, destination) {
        var source = trim(sourceText);
        if (!source) return false;
        if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(source)) return true;
        if (/^(mailto:|tel:|file:|ftp:)/i.test(source)) return true;
        if (/^(www\.)?[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[\/?#].*)?$/.test(source)) return true;
        var dest = trim(destination);
        if (dest && source.toLowerCase() === dest.toLowerCase()) return true;
        return false;
    }

    function sourceFormFor(sourceType, sourceText, linkFileName, destination) {
        if (sourceType === "Inline graphic") return "Inline graphic";
        if (sourceType === "Page item") return linkFileName ? "Graphic" : "Page item";
        if (sourceType === "Cross-reference text") return "Cross-reference";
        if (sourceType === "Text") {
            return looksLikeRawUrlSource(sourceText, destination) ? "Raw URL" : "Descriptive text";
        }
        return sourceType || "Other";
    }

    function suspiciousTrailingUrlPunctuation(destination) {
        var value = trim(destination);
        if (!value) return false;
        return /[.,;:]$/.test(value);
    }

    function hyperlinkSourceInfo(hyperlink) {
        var result = {
            target: null,
            sourceType: "Unknown",
            sourceText: "",
            pageName: "",
            objectId: "",
            objectType: "",
            linkFileName: "",
            frameLabelName: "",
            geometricBounds: "",
            storyFrameId: ""
        };
        try {
            var source = hyperlink.source;
            var sourceType = ctorName(source);
            if (sourceType === "HyperlinkTextSource" || sourceType === "CrossReferenceSource") {
                var text = source.sourceText;
                var inlineItem = inlinePageItemFromText(text);
                if (inlineItem) {
                    result.target = inlineItem;
                    result.sourceType = "Inline graphic";
                    var inlineFile = linkFileNameFor(inlineItem);
                    var inlineLabel = frameLabelNameFor(inlineItem);
                    if (inlineFile) result.sourceText = inlineFile;
                    else if (inlineLabel) result.sourceText = inlineLabel;
                    else result.sourceText = ctorName(inlineItem) || "Inline graphic";
                } else {
                    result.target = text;
                    result.sourceType = sourceType === "CrossReferenceSource" ? "Cross-reference text" : "Text";
                    try { result.sourceText = oneLineText(text.contents, 180); } catch (eText) {}
                }
            } else if (sourceType === "HyperlinkPageItemSource") {
                var item = source.sourcePageItem;
                result.target = item;
                result.sourceType = "Page item";
                var fileName = linkFileNameFor(item);
                var labelName = frameLabelNameFor(item);
                if (fileName) result.sourceText = "Graphic: " + fileName;
                else if (labelName) result.sourceText = labelName;
                else result.sourceText = ctorName(item) || "Page item";
            } else {
                result.target = source;
                result.sourceType = sourceType || "Unknown";
                try { result.sourceText = oneLineText(source.name, 180); } catch (eName) {}
            }
        } catch (eSource) {}

        var page = pageOf(result.target);
        result.pageName = pageName(page);
        var meta = objectMetadataFor(result.target);
        result.objectId = meta.objectId;
        result.objectType = meta.objectType;
        result.linkFileName = meta.linkFileName;
        result.frameLabelName = meta.frameLabelName;
        result.geometricBounds = meta.geometricBounds;
        result.storyFrameId = meta.storyFrameId;
        return result;
    }

    function hyperlinkDestinationInfo(hyperlink) {
        var result = {
            direction: "UNKNOWN",
            category: "Unknown destination",
            destination: ""
        };
        try {
            var dest = hyperlink.destination;
            var typeName = ctorName(dest);
            if (typeName === "HyperlinkPageDestination") {
                result.direction = "INTERNAL";
                result.category = "Page";
                try { result.destination = "Page " + pageName(dest.destinationPage); } catch (ePage) {}
            } else if (typeName === "HyperlinkTextDestination") {
                result.direction = "INTERNAL";
                result.category = "Text";
                try {
                    result.destination = locationFor(dest.destinationText, "Document") + " | " +
                        oneLineText(dest.destinationText.contents, 120);
                } catch (eText) {}
            } else if (typeName === "ParagraphDestination") {
                result.direction = "INTERNAL";
                result.category = "Paragraph";
                try {
                    result.destination = locationFor(dest.destinationText, "Document") + " | " +
                        oneLineText(dest.destinationText.paragraphs[0].contents, 120);
                } catch (eParagraph) {}
            } else if (typeName === "HyperlinkExternalPageDestination") {
                result.direction = "EXTERNAL";
                result.category = "External document page";
                try {
                    result.destination = safeString(dest.documentPath.fsName) + " | page index " + safeString(dest.destinationPageIndex);
                } catch (eExternalPage) {}
            } else if (typeName === "HyperlinkURLDestination") {
                var url = "";
                try { url = trim(dest.destinationURL); } catch (eUrl) {}
                result.destination = url;
                if (!url) {
                    result.direction = "UNKNOWN";
                    result.category = "Empty URL";
                } else if (/^#/i.test(url)) {
                    result.direction = "INTERNAL";
                    result.category = "Fragment";
                } else {
                    result.direction = "EXTERNAL";
                    if (/^https?:/i.test(url)) result.category = "Web URL";
                    else if (/^mailto:/i.test(url)) result.category = "Email";
                    else if (/^tel:/i.test(url)) result.category = "Telephone";
                    else if (/^file:/i.test(url)) result.category = "File URL";
                    else if (/^ftp:/i.test(url)) result.category = "FTP";
                    else result.category = "Other URL";
                }
            } else {
                result.direction = "UNKNOWN";
                result.category = typeName || "Unknown destination";
                try { result.destination = oneLineText(dest.name, 180); } catch (eUnknown) {}
            }
        } catch (eDestination) {}
        return result;
    }

    function hyperlinkRecord(hyperlink) {
        var source = hyperlinkSourceInfo(hyperlink);
        var dest = hyperlinkDestinationInfo(hyperlink);
        var scheme = hyperlinkScheme(dest.direction, dest.category, dest.destination);
        var domain = hyperlinkDomain(scheme, dest.destination);
        return {
            hyperlinkId: safeId(hyperlink),
            hyperlinkName: (function () { try { return safeString(hyperlink.name); } catch (e) { return ""; } })(),
            direction: dest.direction,
            category: dest.category,
            scheme: scheme,
            domain: domain,
            pageName: source.pageName,
            sourceType: source.sourceType,
            sourceText: source.sourceText,
            sourceForm: sourceFormFor(source.sourceType, source.sourceText, source.linkFileName, dest.destination),
            destination: dest.destination,
            repetition: "",
            destinationOccurrences: 0,
            target: source.target,
            objectId: source.objectId,
            objectType: source.objectType,
            linkFileName: source.linkFileName,
            frameLabelName: source.frameLabelName,
            geometricBounds: source.geometricBounds,
            storyFrameId: source.storyFrameId
        };
    }

    function hyperlinkDestinationKey(record) {
        return record.direction + "|" + trim(record.destination);
    }

    function addHyperlinkFindings(stats) {
        var records = stats.hyperlinkRecords || [];
        var bySourcePage = {};
        var i;

        for (i = 0; i < records.length; i++) {
            var r = records[i];

            if (r.scheme === "http") {
                addFinding(
                    "INFO",
                    "DOCUMENT",
                    "HYP-002",
                    "HTTP hyperlink destination",
                    "The hyperlink destination uses HTTP rather than HTTPS: " + r.destination + ". Review whether an equivalent HTTPS endpoint exists before publication.",
                    r.target
                );
            }

            if ((r.scheme === "http" || r.scheme === "https" || r.scheme === "ftp") && suspiciousTrailingUrlPunctuation(r.destination)) {
                addFinding(
                    "WARNING",
                    "DOCUMENT",
                    "HYP-003",
                    "Suspicious trailing URL punctuation",
                    "The hyperlink destination ends with punctuation that may have been captured from surrounding prose: " + r.destination + ". Verify the destination before publication.",
                    r.target
                );
            }

            if ((r.sourceForm === "Descriptive text" || r.sourceForm === "Raw URL" || r.sourceForm === "Cross-reference") && r.pageName && trim(r.sourceText)) {
                var sourceKey = r.pageName + "|" + trim(r.sourceText).toLowerCase();
                if (!bySourcePage[sourceKey]) {
                    bySourcePage[sourceKey] = { pageName: r.pageName, sourceText: r.sourceText, records: [], destinations: {} };
                }
                bySourcePage[sourceKey].records.push(r);
                bySourcePage[sourceKey].destinations[trim(r.destination)] = true;
            }
        }

        var key;
        for (key in bySourcePage) {
            if (!bySourcePage.hasOwnProperty(key)) continue;
            var group = bySourcePage[key];
            var destinations = [];
            var destination;
            for (destination in group.destinations) {
                if (group.destinations.hasOwnProperty(destination)) destinations.push(destination);
            }
            if (destinations.length > 1) {
                destinations.sort();
                addFinding(
                    "WARNING",
                    "DOCUMENT",
                    "HYP-001",
                    "Same hyperlink source text has multiple destinations: " + oneLineText(group.sourceText, 100),
                    "On Page " + group.pageName + ", the same source text points to multiple destinations: " + destinations.join("; ") + ". Review which destination is intended.",
                    group.records[0].target
                );
            }
        }
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
        var meta = objectMetadataFor(target);
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
            objectId: meta.objectId,
            objectType: meta.objectType,
            linkFileName: meta.linkFileName,
            frameLabelName: meta.frameLabelName,
            geometricBounds: meta.geometricBounds,
            storyFrameId: meta.storyFrameId,
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

    function scanDocument(profileKey) {
        state.findings = [];
        state.profileKey = profileFor(profileKey || state.profileKey).key;
        state.scannedAt = new Date();

        var activeProfile = profileFor(state.profileKey);

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
            missingFontsLive: 0,
            missingFontsReferencedOnly: 0,
            paragraphStyles: 0,
            characterStyles: 0,
            objectStyles: 0,
            tableStyles: 0,
            cellStyles: 0,
            hyperlinks: safeLength(doc.hyperlinks),
            hyperlinkInternal: 0,
            hyperlinkExternal: 0,
            hyperlinkUnknown: 0,
            hyperlinkCategories: {},
            hyperlinkSchemes: {},
            hyperlinkDomains: {},
            hyperlinkSourceForms: {},
            hyperlinkDestinationCounts: {},
            hyperlinkUniqueDestinations: 0,
            hyperlinkRepeatedDestinations: 0,
            hyperlinkRepeatedOccurrences: 0,
            hyperlinkRecords: [],
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

        // Fonts. DOC-006A reports unavailable fonts used by live text.
        // DOC-006B reports unavailable font references with no live text use found.
        var unavailableFonts = [];
        var liveMissingByName = {};

        for (i = 0; i < stats.fonts; i++) {
            try {
                var font = doc.fonts[i];
                if (font.status !== FontStatus.INSTALLED) {
                    var fontName = safeString(font.name);
                    stats.missingFonts++;
                    unavailableFonts.push(font);
                }
            } catch (eFontRef) {}
        }

        for (i = 0; i < stats.stories; i++) {
            try {
                var fontStory = doc.stories[i];
                var ranges = fontStory.textStyleRanges;
                var r;
                for (r = 0; r < ranges.length; r++) {
                    try {
                        var range = ranges[r];
                        var applied = range.appliedFont;
                        var appliedStatus = null;
                        try { appliedStatus = applied.status; } catch (eAppliedStatus) { appliedStatus = null; }
                        if (applied && appliedStatus !== null && appliedStatus !== FontStatus.INSTALLED) {
                            var appliedName = safeString(applied.name);
                            var usageKey = "$" + appliedName;
                            if (!liveMissingByName[usageKey]) {
                                liveMissingByName[usageKey] = { font: applied, target: range, ranges: 0 };
                            }
                            liveMissingByName[usageKey].ranges++;
                        }
                    } catch (eRange) {}
                }
            } catch (eFontStory) {}
        }

        for (i = 0; i < unavailableFonts.length; i++) {
            try {
                var unavailableFont = unavailableFonts[i];
                var unavailableName = safeString(unavailableFont.name);
                var liveUse = liveMissingByName["$" + unavailableName];
                if (liveUse) {
                    stats.missingFontsLive++;
                    addFinding(
                        "ERROR",
                        "DOCUMENT",
                        "DOC-006A",
                        "Unavailable font used by live text: " + unavailableName,
                        "Live composed text uses a font that InDesign does not report as installed and available. The reported target is the first detected text-style range; " +
                            fmt(liveUse.ranges) + " text-style range(s) use this unavailable font.",
                        liveUse.target
                    );
                } else {
                    stats.missingFontsReferencedOnly++;
                    addFinding(
                        "INFO",
                        "DOCUMENT",
                        "DOC-006B",
                        "Unavailable font referenced but no live text use found: " + unavailableName,
                        "The document references this unavailable font, but DocStats did not find it applied to live text-style ranges. The reference can come from styles, imported content, or other document resources and should be reviewed before removal or substitution.",
                        null
                    );
                }
            } catch (eFontFinding) {}
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
                        if (activeProfile.minEffectivePpi > 0 && effective > 0 && effective < activeProfile.minEffectivePpi) {
                            addFinding(
                                "WARNING",
                                "PRINT/PDF",
                                "PRINT-001",
                                "Low effective image resolution: " + Math.round(effective) + " PPI",
                                "The bitmap image is below the " + activeProfile.name + " profile advisory threshold of " + activeProfile.minEffectivePpi + " effective PPI. Required resolution depends on output process, line screen, source content, and viewing distance.",
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

        // Hyperlink inventory. Hyperlinks are classified independently from link-file status.
        for (i = 0; i < stats.hyperlinks; i++) {
            try {
                var hyperlink = doc.hyperlinks[i];
                var record = hyperlinkRecord(hyperlink);
                stats.hyperlinkRecords.push(record);
                if (record.direction === "INTERNAL") stats.hyperlinkInternal++;
                else if (record.direction === "EXTERNAL") stats.hyperlinkExternal++;
                else stats.hyperlinkUnknown++;
                incrementCount(stats.hyperlinkCategories, record.direction + " | " + record.category);
                incrementCount(stats.hyperlinkSchemes, record.scheme);
                incrementCount(stats.hyperlinkSourceForms, record.sourceForm);
                if (record.domain) incrementCount(stats.hyperlinkDomains, record.domain);
                incrementCount(stats.hyperlinkDestinationCounts, hyperlinkDestinationKey(record));
            } catch (eHyperlink) {
                stats.hyperlinkUnknown++;
                incrementCount(stats.hyperlinkCategories, "UNKNOWN | Scan error");
                incrementCount(stats.hyperlinkSchemes, "unknown");
            }
        }

        var destinationKey;
        for (destinationKey in stats.hyperlinkDestinationCounts) {
            if (!stats.hyperlinkDestinationCounts.hasOwnProperty(destinationKey)) continue;
            stats.hyperlinkUniqueDestinations++;
            if (stats.hyperlinkDestinationCounts[destinationKey] > 1) {
                stats.hyperlinkRepeatedDestinations++;
                stats.hyperlinkRepeatedOccurrences += stats.hyperlinkDestinationCounts[destinationKey];
            }
        }
        for (i = 0; i < stats.hyperlinkRecords.length; i++) {
            var hyperlinkRecordItem = stats.hyperlinkRecords[i];
            var occurrenceCount = stats.hyperlinkDestinationCounts[hyperlinkDestinationKey(hyperlinkRecordItem)] || 1;
            hyperlinkRecordItem.destinationOccurrences = occurrenceCount;
            hyperlinkRecordItem.repetition = occurrenceCount > 1 ? "Repeated destination" : "Unique destination";
        }
        addHyperlinkFindings(stats);

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

    function findingSummaryLines(findings) {
        var lines = [];
        var errors = 0;
        var warnings = 0;
        var infos = 0;
        var scopes = { "DOCUMENT": 0, "PRINT/PDF": 0, "EPUB": 0 };
        var codes = {};
        var codeOrder = [];
        var i;
        for (i = 0; i < findings.length; i++) {
            var f = findings[i];
            if (f.severity === "ERROR") errors++;
            else if (f.severity === "WARNING") warnings++;
            else infos++;
            if (scopes[f.scope] === undefined) scopes[f.scope] = 0;
            scopes[f.scope]++;
            if (codes[f.code] === undefined) {
                codes[f.code] = 0;
                codeOrder.push(f.code);
            }
            codes[f.code]++;
        }
        codeOrder.sort();
        lines.push("Total findings: " + fmt(findings.length));
        lines.push("");
        lines.push("By severity");
        lines.push("ERROR: " + fmt(errors));
        lines.push("WARNING: " + fmt(warnings));
        lines.push("INFO: " + fmt(infos));
        lines.push("");
        lines.push("By scope");
        lines.push("DOCUMENT: " + fmt(scopes["DOCUMENT"] || 0));
        lines.push("PRINT/PDF: " + fmt(scopes["PRINT/PDF"] || 0));
        lines.push("EPUB: " + fmt(scopes["EPUB"] || 0));
        lines.push("");
        lines.push("By code");
        for (i = 0; i < codeOrder.length; i++) {
            var code = codeOrder[i];
            lines.push(code + ": " + fmt(codes[code]));
        }
        return lines;
    }

    function findingObjectLines(f) {
        var lines = [];
        if (f.objectId) lines.push("  Object ID: " + f.objectId);
        if (f.objectType) lines.push("  Object type: " + f.objectType);
        if (f.linkFileName) lines.push("  Link/file name: " + f.linkFileName);
        if (f.frameLabelName) lines.push("  Frame label/name: " + f.frameLabelName);
        if (f.geometricBounds) lines.push("  Geometric bounds: " + f.geometricBounds);
        if (f.storyFrameId) lines.push("  Story/frame ID: " + f.storyFrameId);
        return lines;
    }

    function countMapLines(map, limit) {
        var rows = [];
        var key;
        for (key in map) {
            if (map.hasOwnProperty(key)) rows.push({ key: key, count: map[key] });
        }
        rows.sort(function (a, b) {
            if (a.count !== b.count) return b.count - a.count;
            return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
        });
        var lines = [];
        var max = limit && limit < rows.length ? limit : rows.length;
        var i;
        for (i = 0; i < max; i++) lines.push(rows[i].key + ": " + fmt(rows[i].count));
        if (limit && rows.length > limit) lines.push("Other entries: " + fmt(rows.length - limit));
        return lines;
    }

    function hyperlinkSummaryLines(stats) {
        var lines = [];
        lines.push("Internal: " + fmt(stats.hyperlinkInternal));
        lines.push("External: " + fmt(stats.hyperlinkExternal));
        lines.push("Unknown: " + fmt(stats.hyperlinkUnknown));
        lines.push("Unique destinations: " + fmt(stats.hyperlinkUniqueDestinations));
        lines.push("Repeated destination values: " + fmt(stats.hyperlinkRepeatedDestinations));
        lines.push("Occurrences using repeated destinations: " + fmt(stats.hyperlinkRepeatedOccurrences));
        lines.push("");
        lines.push("Destination categories");
        lines = lines.concat(countMapLines(stats.hyperlinkCategories, 0));
        lines.push("");
        lines.push("Schemes");
        lines = lines.concat(countMapLines(stats.hyperlinkSchemes, 0));
        lines.push("");
        lines.push("Source forms");
        lines = lines.concat(countMapLines(stats.hyperlinkSourceForms, 0));
        lines.push("");
        lines.push("Top domains");
        lines = lines.concat(countMapLines(stats.hyperlinkDomains, 20));
        lines.push("");
        lines.push("Complete page-by-page hyperlink inventory: Save hyperlinks CSV...");
        return lines;
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
        var activeProfile = profileFor(state.profileKey);
        lines.push("Profile: " + activeProfile.name);
        lines.push("Effective PPI advisory threshold: " + (activeProfile.minEffectivePpi > 0 ? activeProfile.minEffectivePpi + " PPI" : "disabled"));
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
        lines.push("Fonts referenced: " + fmt(s.fonts));
        lines.push("Fonts unavailable: " + fmt(s.missingFonts));
        lines.push("Unavailable fonts used by live text: " + fmt(s.missingFontsLive));
        lines.push("Unavailable fonts referenced only: " + fmt(s.missingFontsReferencedOnly));
        lines.push("Paragraph styles: " + fmt(s.paragraphStyles));
        lines.push("Character styles: " + fmt(s.characterStyles));
        lines.push("Object styles: " + fmt(s.objectStyles));
        lines.push("Table styles: " + fmt(s.tableStyles));
        lines.push("Cell styles: " + fmt(s.cellStyles));

        lines.push("");
        lines.push("NAVIGATION / INTERACTIVE");
        lines.push("------------------------");
        lines.push("Hyperlinks: " + fmt(s.hyperlinks));
        lines.push("Internal hyperlinks: " + fmt(s.hyperlinkInternal));
        lines.push("External hyperlinks: " + fmt(s.hyperlinkExternal));
        lines.push("Unknown/unresolved hyperlinks: " + fmt(s.hyperlinkUnknown));
        lines.push("Cross-reference sources: " + fmt(s.crossReferences));
        lines.push("Bookmarks: " + fmt(s.bookmarks));
        lines.push("Articles: " + fmt(s.articles));

        lines.push("");
        lines.push("HYPERLINK SUMMARY");
        lines.push("-----------------");
        lines = lines.concat(hyperlinkSummaryLines(s));

        lines.push("");
        lines.push("FINDINGS SUMMARY");
        lines.push("----------------");
        lines = lines.concat(findingSummaryLines(findings));

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
                lines = lines.concat(findingObjectLines(f));
                if (f.actionLabel) lines.push("  Available action: " + f.actionLabel);
            }
        }

        lines.push("");
        lines.push("Notes:");
        lines.push("- Scan operations are read-only.");
        lines.push("- Actions run only after explicit user selection; destructive or ambiguous remediation is intentionally excluded.");
        lines.push("- Locate uses the page and selection InDesign exposes for the affected object.");
        lines.push("- Effective-PPI checks use the selected profile; profile values are advisory production defaults defined in PROFILES near the top of the script.");
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
            outFile.writeln("Severity,Scope,Profile,Code,Page,Location,Object ID,Object type,Link/file name,Frame label/name,Geometric bounds,Story/frame ID,Finding,Detail,Action");
            var i;
            for (i = 0; i < findings.length; i++) {
                var f = findings[i];
                outFile.writeln([
                    csvEscape(f.severity),
                    csvEscape(f.scope),
                    csvEscape(profileFor(state.profileKey).name),
                    csvEscape(f.code),
                    csvEscape(f.pageName),
                    csvEscape(f.location),
                    csvEscape(f.objectId),
                    csvEscape(f.objectType),
                    csvEscape(f.linkFileName),
                    csvEscape(f.frameLabelName),
                    csvEscape(f.geometricBounds),
                    csvEscape(f.storyFrameId),
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

    function saveHyperlinkCsv() {
        var records = state.stats.hyperlinkRecords || [];
        var now = state.scannedAt || new Date();
        var baseName = doc.name.replace(/\.[^\.]+$/, "");
        var suggestedName = baseName + "_DocStats_Hyperlinks_" + fileTimestamp(now) + ".csv";
        var defaultFile;
        try {
            defaultFile = doc.saved ? File(doc.filePath.fsName + "/" + suggestedName) : File(Folder.desktop.fsName + "/" + suggestedName);
        } catch (eDefault) {
            defaultFile = File(Folder.desktop.fsName + "/" + suggestedName);
        }
        var outFile = defaultFile.saveDlg("Save DocStats hyperlink inventory", "CSV Files:*.csv");
        if (!outFile) return;
        try {
            outFile.encoding = "UTF-8";
            outFile.lineFeed = "Windows";
            if (!outFile.open("w")) throw new Error("Could not open selected file for writing.");
            outFile.writeln("Direction,Category,Scheme,Domain,Page,Source type,Source form,Source text/graphic,Destination,Repetition,Destination occurrences,Hyperlink ID,Hyperlink name,Object ID,Object type,Link/file name,Frame label/name,Geometric bounds,Story/frame ID");
            var i;
            for (i = 0; i < records.length; i++) {
                var h = records[i];
                outFile.writeln([
                    csvEscape(h.direction),
                    csvEscape(h.category),
                    csvEscape(h.scheme),
                    csvEscape(h.domain),
                    csvEscape(h.pageName),
                    csvEscape(h.sourceType),
                    csvEscape(h.sourceForm),
                    csvEscape(h.sourceText),
                    csvEscape(h.destination),
                    csvEscape(h.repetition),
                    csvEscape(h.destinationOccurrences),
                    csvEscape(h.hyperlinkId),
                    csvEscape(h.hyperlinkName),
                    csvEscape(h.objectId),
                    csvEscape(h.objectType),
                    csvEscape(h.linkFileName),
                    csvEscape(h.frameLabelName),
                    csvEscape(h.geometricBounds),
                    csvEscape(h.storyFrameId)
                ].join(","));
            }
            outFile.close();
            alert("DocStats hyperlink CSV saved:\n\n" + outFile.fsName);
        } catch (e) {
            try { if (outFile.opened) outFile.close(); } catch (eClose) {}
            alert("DocStats could not save the hyperlink CSV.\n\n" + e);
        }
    }

    // ------------------------------------------------------------
    // ScriptUI palette
    // ------------------------------------------------------------

    scanDocument(DEFAULT_PROFILE_KEY);

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
    controls.add("statictext", undefined, "Profile:");
    var profileList = controls.add("dropdownlist", undefined, ["General Health", "Print Production", "EPUB"]);
    profileList.selection = 0;

    var scanButton = controls.add("button", undefined, "Scan");
    var saveButton = controls.add("button", undefined, "Save report...");
    var csvButton = controls.add("button", undefined, "Save findings CSV...");
    var hyperlinkCsvButton = controls.add("button", undefined, "Save hyperlinks CSV...");

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

    function selectedProfileKey() {
        if (!profileList.selection) return DEFAULT_PROFILE_KEY;
        var label = profileList.selection.text;
        if (label === "Print Production") return "PRINT";
        if (label === "EPUB") return "EPUB";
        return "GENERAL";
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
            f.location + "\r" +
            (f.objectId ? "Object ID: " + f.objectId + "\r" : "") +
            (f.objectType ? "Object type: " + f.objectType + "\r" : "") +
            (f.linkFileName ? "Link/file name: " + f.linkFileName + "\r" : "") +
            (f.frameLabelName ? "Frame label/name: " + f.frameLabelName + "\r" : "") +
            (f.geometricBounds ? "Geometric bounds: " + f.geometricBounds + "\r" : "") +
            (f.storyFrameId ? "Story/frame ID: " + f.storyFrameId + "\r" : "") +
            "\r" + f.title + "\r" +
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
            " | Profile " + profileFor(state.profileKey).name +
            " | Findings " + fmt(state.filtered.length) +
            " (" + errors + " error, " + warnings + " warning, " + infos + " info)";

        updateDetail();
    }

    scopeList.onChange = refreshList;
    profileList.onChange = function () {
        scanDocument(selectedProfileKey());
        refreshList();
    };
    list.onChange = updateDetail;

    scanButton.onClick = function () {
        scanDocument(selectedProfileKey());
        refreshList();
    };

    saveButton.onClick = function () {
        saveTextReport(selectedScope());
    };

    csvButton.onClick = function () {
        saveCsv(selectedScope());
    };

    hyperlinkCsvButton.onClick = function () {
        saveHyperlinkCsv();
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
            scanDocument(state.profileKey);
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
