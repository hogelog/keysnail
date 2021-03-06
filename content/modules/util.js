/**
 * @fileOverview Collection of utilities
 * @name util.js
 * @author mooz <stillpedant@gmail.com>
 * @license The MIT License
 */

KeySnail.Util = function () {
    /**
     * @private
     */

    const Cc = Components.classes;
    const Ci = Components.interfaces;

    let modules;

    let self = {
        modules                : null,
        autoCompleteController : null,

        init: function () {
            modules = self.modules;

            this.sandboxForSafeEval = new Components.utils.Sandbox("about:blank");
            this.userContext = {
                __proto__: this.parent.modules
            };

            // ============================================================ //

            const responseType = "application/x-suggestions+json";

            let ss   = Cc["@mozilla.org/browser/search-service;1"].getService(Ci.nsIBrowserSearchService);
            let json = Cc["@mozilla.org/dom/json;1"].createInstance(Ci.nsIJSON);

            this.suggest = {
                ss            : ss,
                responseType  : responseType,
                getEngines    : function () { return ss.getVisibleEngines({}); },

                // partially borrowed from bookmarks.js of liberator
                ensureAliases : function (aEngines) {
                    for (let [, engine] in Iterator(aEngines))
                    {
                        if (!engine.alias)
                        {
                            let alias = engine.alias;
                            if (!alias || !/^[a-z0-9_-]+$/.test(alias))
                                alias = engine.name.replace(/^\W*([a-zA-Z_-]+).*/, "$1").toLowerCase();
                            if (!alias)
                                alias = "search";

                            let newAlias = alias;
                            for (let j = 1; j <= 10; j++)
                            {
                                if (!aEngines.some(function (item) item[0] == newAlias))
                                    break;

                                newAlias = alias + j;
                            }

                            if (engine.alias !== newAlias)
                                engine.alias = newAlias;
                        }
                    }

                    return aEngines;
                },

                filterEngines  : function (aEngines) {
                    return aEngines.filter(function (engine) engine.supportsResponseType(responseType));
                },

                getSuggestions : function (aEngine, query, callback) {
                    let queryURI;
                    let engine = aEngine;

                    let util = KeySnail.modules.util;

                    if (engine && engine.supportsResponseType(responseType))
                        queryURI = engine.getSubmission(query, responseType).uri.spec;

                    if (queryURI)
                    {
                        if (callback)
                        {
                            util.httpGet(queryURI, false, function (xhr) {
                                             let results = json.decode(xhr.responseText) || {1:[]};
                                             callback(results[1]);
                                         });
                            return null;
                        }
                        else
                        {
                            let xhr = util.httpGet(queryURI);
                            let results = json.decode(xhr.responseText) || {1:[]};
                            return results[1];
                        }
                    }

                    return [];
                },

                searchWithSuggest: function (aSearchEngine, aSuggestEngines, aOpenStyle) {
                    let util      = KeySnail.modules.util;
                    let prompt    = KeySnail.modules.prompt;
                    let completer = KeySnail.modules.completer;

                    prompt.reader(
                        {
                            message    : util.format("Search [%s]:", aSearchEngine.name),
                            group      : "web-search",
                            flags      : [0, 0],
                            style      : ["", "color:#545454"],
                            completer  : completer.fetch.suggest(aSuggestEngines, true),
                            callback   : function (query) {
                                if (query)
                                {
                                    let uri = aSearchEngine.getSubmission(query, null).uri.spec;
                                    openUILinkIn(uri, aOpenStyle || "tab");
                                }
                            }
                        }
                    );
                }
            };
        },

        get userLocale() {
            var locale = this.getUnicharPref("general.useragent.locale");

            return {
                // ja
                "ja"        : "ja",
                "ja-JP"     : "ja",
                "ja-JP-mac" : "ja",
                "ja_JP"     : "ja",
                "JP"        : "ja",
                // en
                "en-US"     : "en"
            }[locale] || "en";
        },

        get mPrefService() {
            return Cc["@mozilla.org/preferences-service;1"]
                .getService(Ci.nsIPrefBranch);
        },

        get focusedElement() {
            return document.commandDispatcher.focusedElement;
        },

        // File IO {{ =============================================================== //

        /**
         * Open file specified by <b>aPath</b> and returns it.
         * @param {string} aPath file path to be opened
         * @returns {nsILocalFile} opened file
         */
        openFile: function (aPath) {
            var file = Cc["@mozilla.org/file/local;1"]
                .createInstance(Ci.nsILocalFile);
            file.initWithPath(aPath);

            return file;
        },

        /**
         * Open text file, read its content, and returns it.
         * @param {string} aPath file path to be read
         * @param {string} aCharset specify text charset
         * @returns {string} text content of the file
         * @throws {}
         */
        readTextFile: function (aPath, aCharset) {
            // Create the file instance
            var file = this.openFile(aPath);

            if (!file.exists())
                throw aPath + " not found";

            // Create stream for reading text
            var fileStream = Components
                .classes["@mozilla.org/network/file-input-stream;1"]
                .createInstance(Ci.nsIFileInputStream);
            fileStream.init(file, 1, 0, false);

            // Convert char-code
            var converterStream = Components
                .classes["@mozilla.org/intl/converter-input-stream;1"]
                .createInstance(Ci.nsIConverterInputStream);
            if (!aCharset)
                aCharset = 'UTF-8';
            converterStream.init(fileStream, aCharset, fileStream.available(),
                                 converterStream.DEFAULT_REPLACEMENT_CHARACTER);
            // Output
            var out = new Object();
            converterStream.readString(fileStream.available(), out);

            converterStream.close();
            fileStream.close();

            return out.value;
        },

        /**
         * read file contained in the package (jar)
         * original code by Torisugari
         * http://forums.mozillazine.org/viewtopic.php?p=921150
         * @param {string} aURL location of the file
         * @returns {string} content of the file
         */
        readTextFileFromPackage: function (aURL) {
            var ioService = Cc["@mozilla.org/network/io-service;1"]
                .getService(Ci.nsIIOService);
            var scriptableStream = Components
                .classes["@mozilla.org/scriptableinputstream;1"]
                .getService(Ci.nsIScriptableInputStream);

            try {
                var channel = ioService.newChannel(aURL, null, null);
                var input = channel.open();

                scriptableStream.init(input);
                var str = scriptableStream.read(input.available());
            } catch (e) {
                // this.message("readTextFileFromPackage: " + e);
                return null;
            }

            scriptableStream.close();
            input.close();

            return str;
        },

        /**
         * Write <b>aString</b> to the local file specified by <b>aPath</b>.
         * Overwrite confirmation will be ommitted if <b>aForce</b> is true.
         * "Don't show me again" checkbox value managed by <b>aCheckID</b>.
         * @param {string} aString
         * @param {string} aPath
         * @param {boolean} aForce
         * @param {string} aCheckID
         * @throws {}
         */
        writeTextFile: function (aString, aPath, aForce, aCheckID) {
            var file = this.openFile(aPath);

            if (file.exists() &&
                !aForce &&
                (aCheckID ?
                 !this.confirmCheck(this.getLocaleString("overWriteConfirmationTitle"),
                                    this.getLocaleString("overWriteConfirmation", [aPath]),
                                    this.getLocaleString("overWriteConfirmationCheck"),
                                    aCheckID) :
                 !this.confirm(this.getLocaleString("overWriteConfirmationTitle"),
                               this.getLocaleString("overWriteConfirmation", [aPath]))))
            {
                throw "Canceled by user";
            }

            var fileStream = Components
                .classes["@mozilla.org/network/file-output-stream;1"]
                .createInstance(Ci.nsIFileOutputStream);
            fileStream.init(file, 0x02 | 0x08 | 0x20, 0644, false);

            var wrote = fileStream.write(aString, aString.length);
            if (wrote != aString.length) {
                throw "Failed to write whole string";
            }

            fileStream.close();
        },

        // }} ======================================================================= //

        // File {{ ================================================================== //

        hashFile: function (aFile, aType, aBinary) {
            let preferAscii = !aBinary;

            let istream = Cc["@mozilla.org/network/file-input-stream;1"]
                .createInstance(Ci.nsIFileInputStream);
            istream.init(aFile, 0x01, 0444, 0);

            let ch = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
            ch.init(aType || ch.MD5);

            const PR_UINT32_MAX = 0xffffffff;
            ch.updateFromStream(istream, PR_UINT32_MAX);

            // if false is given, binary data will be returend
            let hash = ch.finish(preferAscii);

            if (!preferAscii)
            {
                // returns pair of hex code for given 1 byte
                function toHexString(charCode) ("0" + charCode.toString(16)).slice(-2);

                return [toHexString(hash.charCodeAt(i)) for (i in hash)].join("");
            }

            return hash;
        },

        // }} ======================================================================= //

        // Prompt wrapper {{ ======================================================== //

        /**
         * window.alert alternative.
         * This method can specify the window title while window.alert can't.
         * @param {string} aTitle
         * @param {string} aMessage
         * @param {window} aWindow
         */
        alert: function (aTitle, aMessage, aWindow) {
            var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                .getService(Ci.nsIPromptService);
            prompts.alert(aWindow || window, aTitle, aMessage);
        },

        /**
         * window.confirm alternative.
         * This method can specify the window title while window.confirm can't.
         * @param {} aTitle
         * @param {} aMessage
         * @returns {}
         */
        confirm: function (aTitle, aMessage, aWindow) {
            var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                .getService(Ci.nsIPromptService);

            return prompts.confirm(aWindow || window, aTitle, aMessage);
        },

        /**
         * Confirm dialog with the "don't ask me again" checkbox
         * @param {string} aTitle title of the dialog
         * @param {string} aMessage message of the dialog
         * @param {string} aCheckMessage message displayed near the checkbox
         * @param {string} aId preference key to save the "don't ask me again" value
         * @returns {boolean} true when user pressed OK, and false when Canceled
         */
        confirmCheck: function (aTitle, aMessage, aCheckMessage, aId) {
            var key = "extensions.keysnail." + aId;

            if (this.getBoolPref(key, false))
                return true;

            var prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                .getService(Ci.nsIPromptService);

            var check = {value: false};
            var result = prompts.confirmCheck(null,
                                              aTitle,
                                              aMessage,
                                              aCheckMessage,
                                              check);
            if (result)
                this.setBoolPref(key, check.value);

            return result;
        },

        // }} ======================================================================= //

        // Misc utils {{ ============================================================ //

        /**
         * list all properties of the object
         * @param {object} aObject target object
         */
        listProperty: function (aObject) {
            if (!aObject) {
                this.message("listProperty: undefined object passed");
            } else {
                for (var property in aObject) {
                    this.message(aObject.toString()
                                 + "[" + property + "] = "
                                 + aObject[property]);
                }
            }
        },

        /**
         * check if the command is usable
         * @param {string} aCommand command name
         * @returns {boolean} true if aCommand is usable in current situation
         */
        isCommandUsable: function (aCommand) {
            var controller = document.commandDispatcher
                .getControllerForCommand(aCommand);
            return (controller && controller.isCommandEnabled(aCommand));
        },

        // }} ======================================================================= //

        // Predicatives {{ ========================================================== //

        /**
         * check if user can input any text in current situation
         * original code from Firemacs
         * http://www.mew.org/~kazu/proj/firemacs/
         * @param {event} aEvent keypress (or any) event with property originalTarget
         * @returns {boolean} true if text is insertable
         */
        isWritable: function (aEvent) {
            var localName = aEvent.originalTarget.localName.toLowerCase();

            // in select or option, we shold ignore the alphabet key
            if (localName === 'select' || localName === 'option')
                return true;

            var insertTextController= document.commandDispatcher
                .getControllerForCommand("cmd_insertText");

            try
            {
                return (insertTextController &&
                        insertTextController.isCommandEnabled("cmd_insertText"));
            }
            catch (x)
            {
                return (localName === 'input' || localName === 'textarea');
            }
        },

        /**
         * check if cursor is in the autocomplete menu
         * original code from Firemacs
         * http://www.mew.org/~kazu/proj/firemacs/
         * @returns {boolean} true if cursor is in the autocomplete menu
         */
        isMenu: function () {
            var autoCompleteController =
                Cc['@mozilla.org/autocomplete/controller;1']
                .getService(Ci.nsIAutoCompleteController);

            if (autoCompleteController.matchCount !== 0)
            {
                var open = false;
                var actpps = document.getElementsByAttribute('autocompletepopup', '*');
                var len = actpps.length;
                for (var i = 0; i < len; i++)
                {
                    open = open || document.getElementById(actpps[i].getAttribute('autocompletepopup'))
                        .QueryInterface(Ci.nsIAutoCompletePopup).popupOpen;
                }
                return open;
            }
            return false;
        },

        /**
         * check if the caret is visible
         * @returns {boolean} true if caret is visible
         */
        isCaretEnabled: function () {
            try {
                return this.getSelectionController().getCaretEnabled();
            } catch (x) {
                return false;
            }
        },

        /**
         * check if the current document is consist of frameset or not
         * @param {window} aFrameWindow
         * @returns {boolean} true if current document is consist of frameset
         */
        isFrameSetWindow: function (aFrameWindow) {
            if (!aFrameWindow) {
                return false;
            }

            var listElem = aFrameWindow.document.documentElement
                .getElementsByTagName('frameset');

            return (listElem && listElem.length > 0);
        },

        // }} ======================================================================= //

        // nsI {{ =================================================================== //

        /**
         * Returns selection controller, which has lot of commands like scroll.
         * @returns {nsISelectionController} selection controller
         */
        getSelectionController: function () {
            var docShell = document.commandDispatcher.focusedWindow
                .QueryInterface(Ci.nsIInterfaceRequestor)
                .getInterface(Ci.nsIWebNavigation)
                .QueryInterface(Ci.nsIDocShell);

            return docShell
                .QueryInterface(Ci.nsIInterfaceRequestor)
                .getInterface(Ci.nsISelectionDisplay)
                .QueryInterface(Ci.nsISelectionController);
        },

        // }} ======================================================================= //

        // Event {{ ================================================================= //

        /**
         * stop event propagation and prevent browser default behavior
         * @param {event} aEvent event to stop
         */
        stopEventPropagation: function (aEvent) {
            aEvent.stopPropagation();
            aEvent.preventDefault();
        },

        // }} ======================================================================= //

        // Preference {{ ============================================================ //
        // some method's are borrowed from chrome://global/content/nsUserSettings.js

        /**
         * set preference value at a stroke
         * @param {object} aPrefList {key : value} pair
         */
        setPrefs: function (aPrefList) {
            var value;
            for (var prefKey in aPrefList) {
                value = aPrefList[prefKey];
                switch (typeof(value)) {
                case 'string':
                    this.setUnicharPref(prefKey, value);
                    break;
                case 'number':
                    this.setIntPref(prefKey, value);
                    break;
                case 'boolean':
                    this.setBoolPref(prefKey, value);
                    break;
                }
            }
        },

        setBoolPref: function (aPrefName, aPrefValue) {
            try
            {
                this.mPrefService.setBoolPref(aPrefName, aPrefValue);
            }
            catch (e) {}
        },

        getBoolPref: function (aPrefName, aDefVal) {
            try
            {
                return this.mPrefService.getBoolPref(aPrefName);
            }
            catch (e)
            {
                return typeof aDefVal === "undefined" ? null : aDefVal;
            }

            return null;
        },

        /**
         * set unicode string preference value
         * @param {string} aStringKey key of the preference
         * @param {string} aValue value of the preference specified by <b>aStringKey</b>
         */
        setUnicharPref: function (aPrefName, aPrefValue) {
            try
            {
                var str = Cc["@mozilla.org/supports-string;1"]
                    .createInstance(Ci.nsISupportsString);
                str.data = aPrefValue;
                this.mPrefService.setComplexValue(aPrefName,
                                                  Ci.nsISupportsString, str);
            }
            catch (e) {}
        },

        /**
         * get unicode string preference value. when localized version is available,
         * that one is used.
         * @param {string} aStringKey key of the preference
         * @returns {string} fetched preference value specified by <b>aStringKey</b>
         */
        getUnicharPref: function (aStringKey) {
            return this.getLocalizedUnicharPref(aStringKey)
                || this.copyUnicharPref(aStringKey);
        },

        copyUnicharPref: function (aPrefName, aDefVal)
        {
            try
            {
                return this.mPrefService.getComplexValue(aPrefName,
                                                         Ci.nsISupportsString).data;
            }
            catch (e)
            {
                return typeof aDefVal === "undefined" ? null : aDefVal;
            }
            return null;        // quiet warnings
        },

        setIntPref: function (aPrefName, aPrefValue)
        {
            try
            {
                this.mPrefService.setIntPref(aPrefName, aPrefValue);
            }
            catch (e) {}
        },

        getIntPref: function (aPrefName, aDefVal)
        {
            try
            {
                return this.mPrefService.getIntPref(aPrefName);
            }
            catch (e)
            {
                return typeof aDefVal === "undefined" ? null : aDefVal;
            }

            return null;        // quiet warnings
        },

        getLocalizedUnicharPref: function (aPrefName, aDefVal)
        {
            try
            {
                return this.mPrefService.getComplexValue(aPrefName,
                                                         Ci.nsIPrefLocalizedString).data;
            }
            catch (e)
            {
                return typeof aDefVal === "undefined" ? null : aDefVal;
            }

            return null;        // quiet warnings
        },

        // }} ======================================================================= //

        // Localization {{ ========================================================== //

        /**
         * get localized string
         * original code from Firegestures
         * http://www.xuldev.org/firegestures/
         * @param {string} aStringKey string bundle key
         * @param {[string]} aReplacements arguments be to replace the %S in format
         * @returns {string} localized key on success and string key on failure
         */
        getLocaleString: function (aStringKey, aReplacements) {
            if (!this._stringBundle)
            {
                const kBundleURI = "chrome://keysnail/locale/keysnail.properties";
                var bundleSvc = Cc["@mozilla.org/intl/stringbundle;1"]
                    .getService(Ci.nsIStringBundleService);
                this._stringBundle = bundleSvc.createBundle(kBundleURI);
            }

            try
            {
                if (!aReplacements)
                    return this._stringBundle.GetStringFromName(aStringKey);
                else
                    return this._stringBundle
                    .formatStringFromName(aStringKey, aReplacements, aReplacements.length);
            }
            catch (e)
            {
                return aStringKey;
            }
        },

        // }} ======================================================================= //

        // Directory {{ ============================================================= //

        changeDirectory: function (path) {
            with (KeySnail.modules)
            {
                let dest;

                if (path === "-")
                {
                    if (!share.oldpwd)
                        share.oldpwd = share.pwd;
                    dest = share.oldpwd;
                }
                else
                    dest = completer.utils.normalizePath(path);

                let dir = util.openFile(dest);
                if (!dir)
                {
                    display.echoStatusBar("Failed to change current directory");
                    return;
                }

                if (!dir.exists())
                {
                    display.echoStatusBar("No such directory " + dest);
                    return;
                }

                if (!dir.isDirectory())
                {
                    display.echoStatusBar(dest + " is not a directory");
                    return;
                }

                share.oldpwd = share.pwd;
                share.pwd    = dir.path;

                return dir;
            }
        },

        /**
         * check if the directory has certain files
         * @param {string} aPath
         * @param {string} aDirectoryDelimiter
         * @param {[string]} aFileNames
         * @returns {boolean} true if the directory specified <b>aPath</b> has any file contained in <b>aFileNames</b>.
         */
        isDirHasFiles: function (aPath, aDirectoryDelimiter, aFileNames) {
            var file;

            for (var i in aFileNames) {
                file = this.openFile(aPath + aDirectoryDelimiter
                                     + aFileNames[i]);
                if (file.exists()) {
                    return true;
                }
            }

            return false;
        },

        /**
         * Original code by liberator
         * Returns the list of files in <b>aDirectory</b>.
         * @param {nsIFile|string} aDirectory The directory to read, either a full
         *     pathname or an instance of nsIFile.
         * @param {boolean} sort Whether to sort the returned directory
         *     entries.
         * @returns {nsIFile[]}
         * @throws exception when no file found in aDirectory
         */
        readDirectory: function (aDirectory, aSort) {
            if (typeof aDirectory == "string")
                aDirectory = this.openFile(aDirectory);

            if (aDirectory.isDirectory())
            {
                var entries = aDirectory.directoryEntries;
                var array = [];

                while (entries.hasMoreElements())
                {
                    var entry = entries.getNext();
                    array.push(entry.QueryInterface(Ci.nsIFile));
                }

                if (aSort)
                    array.sort(function (a, b) b.isDirectory() - a.isDirectory() ||  String.localeCompare(a.path, b.path));

                return array;
            }
            else
            {
                return [];
            }
        },

        /**
         * get extension's special directory
         * original function from sage
         * @param {string} aProp special directory type
         * @returns {file} special directory
         */
        getSpecialDir: function (aProp) {
            var dirService = Cc['@mozilla.org/file/directory_service;1']
                .getService(Ci.nsIProperties);

            return dirService.get(aProp, Ci.nsILocalFile);
        },

        // }} ======================================================================= //

        // Charactor code {{ ======================================================== //

        /**
         * convert given string's char code
         * original function from sage
         * @param {string} aString target string
         * @param {string} aCharCode aimed charcode
         * @returns {string} charcode converted string
         */
        convertCharCodeFrom: function (aString, aCharCode) {
            var UConvID = "@mozilla.org/intl/scriptableunicodeconverter";
            var UConvIF  = Ci.nsIScriptableUnicodeConverter;
            var UConv = Cc[UConvID].getService(UConvIF);

            var tmpString = "";
            try {
                UConv.charset = aCharCode;
                tmpString = UConv.ConvertFromUnicode(aString);
            } catch (e) {
                tmpString = null;
            }
            return tmpString;
        },

        // }} ======================================================================= //

        // Misc information {{ ====================================================== //

        /**
         * get system information service
         * @returns {}
         */
        getSystemInfo: function () {
            return Cc['@mozilla.org/system-info;1'].
                getService(Ci.nsIPropertyBag2);
        },

        /**
         * get system environment value
         * @param {string} aName name of the environment value
         * @returns {string} environment value or null when not found
         */
        getEnv: function (aName) {
            var env = Cc['@mozilla.org/process/environment;1']
                .getService(Ci.nsIEnvironment);

            return env.exists(aName) ? env.get(aName) : null;
        },

        // }} ======================================================================= //


        // DB {{ ==================================================================== //

        /**
         * get places db, works correctly under any version of Firefox I hope.
         * @returns {dbconnection} places db
         */
        getPlacesDB: function () {
            try
            {
                return Cc['@mozilla.org/browser/nav-history-service;1']
                    .getService(Ci.nsPIPlacesDatabase).DBConnection;
            }
            catch (x)
            {
                var places = Cc["@mozilla.org/file/directory_service;1"].
                    getService(Ci.nsIProperties).
                    get("ProfD", Ci.nsIFile);
                places.append("places.sqlite");

                return Cc["@mozilla.org/storage/service;1"].
                    getService(Ci.mozIStorageService).openDatabase(places);
            }
        },

        // }} ======================================================================= //

        // Path / URL {{ ============================================================ //

        createDirectory: function (aLocalFile) {
            if (aLocalFile.exists() && !aLocalFile.isDirectory())
                aLocalFile.remove(false);

            if (!aLocalFile.exists())
                aLocalFile.create(Ci.nsIFile.DIRECTORY_TYPE, 0755);

            return aLocalFile;
        },

        getExtensionLocalDirectoryRoot: function () {
            const extName = "keysnail";

            var extDir  = this.getSpecialDir("ProfD");
            extDir.append(extName);

            return this.createDirectory(extDir);
        },

        getExtensionLocalDirectory: function (aDirName) {
            var localDir = this.getExtensionLocalDirectoryRoot();
            localDir.append(aDirName);

            return this.createDirectory(localDir);
        },

        /**
         * convert local file path to the URL expression
         * @param {string} aPath local file path
         * @returns {string} URL expression of aPath
         */
        pathToURL: function (aPath) {
            var file = this.openFile(aPath);
            var ioService = Components
                .classes['@mozilla.org/network/io-service;1']
                .getService(Ci.nsIIOService);
            var url = ioService.newFileURI(file);
            var fileURL = url.spec;

            return fileURL;
        },

        /**
         * convert URL to the local file path
         * @param {string} aUrl URL of the file
         * @returns {string} Local path expression of chrome URL
         */
        urlToPath: function (aUrl) {
            var ioService = Components
                .classes['@mozilla.org/network/io-service;1']
                .getService(Ci.nsIIOService);
            var fileHandler = ioService.getProtocolHandler('file')
                .QueryInterface(Ci.nsIFileProtocolHandler);
            var file = fileHandler.getFileFromURLSpec(aUrl);
            var path = file.path;

            return path;
        },

        /**
         * convert chrome://hoge => /foo/bar/.../hoge
         * original code by Jfingland
         * http://forums.mozillazine.org/viewtopic.php?p=921150
         * @param {string} aUrl chrome url to the local file path
         * @returns {string} local file path
         */
        chromeToPath: function (aUrl) {
            if (!aUrl || !(/^chrome:/.test(aUrl)))
                return null;

            var rv;
            var ios = Cc['@mozilla.org/network/io-service;1']
                .getService(Ci["nsIIOService"]);
            var uri = ios.newURI(aUrl, "UTF-8", null);
            var cr = Cc['@mozilla.org/chrome/chrome-registry;1']
                .getService(Ci["nsIChromeRegistry"]);
            rv = cr.convertChromeURL(uri).spec;

            if (/^file:/.test(rv))
                rv = this.urlToPath(rv);
            else
                rv = this.urlToPath("file://"+rv);

            return rv;
        },

        /**
         * return favicon path of the page specified by <b>aUrl</b>
         * @param {string} aURL url of the page
         * @param {string} aDefault default favicon path
         * @returns {string} favicon path
         */
        getFaviconPath: function (aURL, aDefault) {
            if (!this.IOService)
            {
                this.IOService = Cc['@mozilla.org/network/io-service;1']
                    .getService(Ci.nsIIOService);
            }

            var iconURL;

            try
            {
                var icon = PlacesUtils.favicons
                    .getFaviconForPage(this.IOService.newURI(aURL, null, null));
                iconURL = icon.spec;
            }
            catch (x)
            {
                iconURL = aDefault || "chrome://mozapps/skin/places/defaultFavicon.png";
            }

            return iconURL;
        },

        /**
         * Get leaf name from URL path.
         * @param {string} aURL a URL.
         * @returns {string} leaf name
         */
        getLeafNameFromURL: function (aURL) {
            return aURL.slice(aURL.lastIndexOf("/") + 1);
        },

        // }} ======================================================================= //

        // Eval / Voodoo {{ ========================================================= //

        // Inspired by liberator.js
        evalInContext: function (aCode, aContext) {
            const EVAL_ERROR  = "__ks_eval_error";
            const EVAL_RESULT = "__ks_eval_result";
            const EVAL_STRING = "__ks_eval_string";

            try
            {
                if (!aContext)
                    aContext = this.userContext;

                aContext[EVAL_ERROR]  = null;
                aContext[EVAL_STRING] = aCode;
                aContext[EVAL_RESULT] = null;

                modules.userscript.loadSubScript("chrome://keysnail/content/eval.js", aContext);

                if (aContext[EVAL_ERROR])
                    throw aContext[EVAL_ERROR];

                return aContext[EVAL_RESULT];
            }
            finally
            {
                delete aContext[EVAL_ERROR];
                delete aContext[EVAL_RESULT];
                delete aContext[EVAL_STRING];
            }
        },

        /**
         * Eval in sandbox. This method is useful to parse JSON object.
         * @param {} aText
         * @returns {object} result of evaluation
         */
        safeEval: function (aText) {
            return Components.utils.evalInSandbox(aText, this.sandboxForSafeEval);
        },

        /**
         * Eval in sandbox
         * @param {} aContent
         * @param {} aURI
         * @returns {}
         */
        evalInSandbox: function (aContent, aURI) {
            var sandbox = new Components.utils.Sandbox(aURI || content.document.location.href);
            sandbox.window   = content.window;
            sandbox.document = content.document;
            return Components.utils.evalInSandbox(aContent, sandbox);
        },

        // }} ======================================================================= //

        // Network {{ =============================================================== //

        /**
         * Original code by liberator
         * Sends a synchronous HTTP request to <b>aUrl</b> and returns the
         * XMLHttpRequest object. If <b>aCallback</b> is specified the request is
         * asynchronous and the <b>aCallback</b> is invoked with the object as its
         * argument.
         * @param {string} aUrl
         * @param {boolean} aRaw
         * @param {function} aCallback
         * @returns {XMLHttpRequest}
         */
        httpGet: function (aUrl, aRaw, aCallback, aTimeOut)
        {
            try
            {
                let req = new XMLHttpRequest();
                req.mozBackgroundRequest = true;
                let timer;
                let async = typeof aCallback === "function";

                let self = this;

                if (typeof aTimeOut === "number")
                {
                    timer = setTimeout(function () {
                                           self.message("Aborted");
                                           req.abort();
                                       }, 0);
                }

                if (async)
                {
                    req.onreadystatechange = function () {
                        if (req.readyState == 4)
                        {
                            if (timer)
                                clearTimeout(timer);
                            aCallback(req);
                        }
                    };
                }

                req.open("GET", aUrl, async);
                if (aRaw)
                    req.overrideMimeType('text/plain; charset=x-user-defined');
                req.send(null);

                if (timer && !async)
                    clearTimeout(timer);

                return req;
            }
            catch (e)
            {
                self.message("Error opening " + aUrl + " :: " + e);

                return null;
            }
        },

        // }} ======================================================================= //

        // Thread {{ ================================================================ //

        /**
         * sleep current thread for <b>aWait</b> [msec] time.
         * from http://d.hatena.ne.jp/fls/20090224/p1
         * @param {Integer} aWait sleep time in mili-second
         */
        sleep: function (aWait) {
            var timer = {
                timeup: false
            };

            var thread = Cc["@mozilla.org/thread-manager;1"]
                .getService().mainThread;

            var interval = window.setInterval(function () { timer.timeup = true; }, aWait);
            while (!timer.timeup)
            {
                thread.processNextEvent(true);
            }
            window.clearInterval(interval);
        },

        // }} ======================================================================= //

        // XML {{ =================================================================== //

        get XHTML() {
            return "http://www.w3.org/1999/xhtml";
        },

        get XUL() {
            return "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
        },

        // Original code by piro (http://d.hatena.ne.jp/teramako/20081113/p1#c1226602807)
        /**
         * Convert E4X to DOM object
         * @param {} xml
         * @param {} xmlns
         * @returns {}
         */
        xmlToDom: function (xml, xmlns) {
            if (!xmlns)
                xmlns = this.XUL;

            var doc = (new DOMParser).parseFromString(
                '<root xmlns="' + xmlns + '">' + xml.toXMLString() + "</root>",
                "application/xml");
            var imported = document.importNode(doc.documentElement, true);
            var range = document.createRange();
            range.selectNodeContents(imported);
            var fragment = range.extractContents();
            range.detach();
            return fragment.childNodes.length > 1 ? fragment : fragment.firstChild;
        },

        /**
         * Get locale specific string from given node.
         * @param {XML} aNodes E4X type XML object
         * @returns {string} locale specific string of the <b>aNodes</b>
         */
        xmlGetLocaleString: function (aNodes) {
            if (typeof aNodes === "string")
                return aNodes;

            var length = aNodes.length();

            if (length == 0)
                return "";

            for (var i = 0; i < length; ++i)
            {
                if (aNodes[i].@lang.toString() == this.userLocale)
                    return aNodes[i].text();
            }

            return aNodes[0].text();
        },

        // }} ======================================================================= //

        // Bookmarks / Places {{ ==================================================== //

        filterBookmarks: function (aItemId, aFilter, aContainer)
        {
            var parentNode = PlacesUtils.getFolderContents(aItemId).root;

            if (!aContainer)
                aContainer = [];

            for (var i = 0; i < parentNode.childCount; i++)
            {
                var childNode = parentNode.getChild(i);

                if (PlacesUtils.nodeIsBookmark(childNode))
                {
                    let item = aFilter(childNode, parentNode);
                    if (item)
                        aContainer.push(item);
                }
                else if (PlacesUtils.nodeIsFolder(childNode)
                         && !PlacesUtils.nodeIsLivemarkContainer(childNode))
                {
                    arguments.callee(childNode.itemId, aFilter, aContainer);
                }
            }

            return aContainer;
        },

        // }} ======================================================================= //

        // Suggestion {{ ============================================================ //

        suggest: null,

        // }} ======================================================================= //

        // Misc {{ ================================================================== //

        sortMultiple: function ([a], [b]) { return (a < b) ? -1 : (a > b) ? 1 : 0; },

        // }} ======================================================================= //

        // String {{ ================================================================ //

        createSeparator: function (label) {
            var separator = [];
            const SEPARATOR_LENGTH = 74;

            separator.push("// ");

            if (label)
            {
                var hunkLen = Math.round((SEPARATOR_LENGTH - label.length) / 2) - 1;

                separator.push(new Array(hunkLen).join("="));
                separator.push(" " + label + " ");
                separator.push(new Array(hunkLen + (label.length % 2 == 0 ? 1 : 0)).join("="));
            }
            else
            {
                separator.push(new Array(SEPARATOR_LENGTH).join("="));
            }

            separator.push(" //");

            return separator.join("");
        },

        /**
         * String => 'String'
         * @param {string} aStr
         * @returns {string}
         */
        toStringForm: function (aStr) {
            return (typeof aStr === "string") ? "'" + aStr.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'" : "''"; // '
        },

        // }} ======================================================================= //

        format: function (aFormat) {
            for (var i = 1; i < arguments.length; ++i)
            {
                aFormat = aFormat.replace("%s", arguments[i]);
            }

            return aFormat;
        },

        message: KeySnail.message
    };

    return self;
}();
