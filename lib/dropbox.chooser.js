var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
var Carbon;
(function (Carbon) {
    var ExternalChooser = (function () {
        function ExternalChooser() {
            this.loaded = false;
            this.loading = false;
            this.reactive = new Carbon.Reactive();
        }
        ExternalChooser.prototype._open = function () { };
        ;
        ExternalChooser.prototype.loadScript = function (callback) { };
        ;
        ExternalChooser.prototype.open = function () {
            console.log('open');
            if (!this.loaded) {
                this.loadScript(this._open.bind(this));
            }
            else {
                this._open();
            }
        };
        ExternalChooser.prototype.subscribe = function (callback) {
            return this.reactive.subscribe(callback);
        };
        return ExternalChooser;
    })();
    var DropboxChooser = (function (_super) {
        __extends(DropboxChooser, _super);
        function DropboxChooser(key) {
            _super.call(this);
            this.key = key || '3ta2xeuzehs6pob';
        }
        DropboxChooser.prototype._open = function () {
            this.loaded = true;
            Dropbox.choose({
                linkType: 'direct',
                multiselect: true,
                success: this.onSelection.bind(this),
                cancel: this.onCancel.bind(this)
            });
        };
        DropboxChooser.prototype.onCancel = function () { };
        DropboxChooser.prototype.onSelection = function (files) {
            var uploads = files.map(function (file) {
                return new Carbon.UrlUpload(file.link);
            });
            this.reactive.trigger(uploads);
        };
        DropboxChooser.prototype.loadScript = function (callback) {
            var _this = this;
            console.log('load script');
            if (this.loading)
                return;
            this.loading = true;
            var el = document.createElement('script');
            el.id = "dropboxjs";
            el.type = "text/javascript";
            el.async = true;
            el.setAttribute('data-app-key', this.key);
            el.addEventListener('load', function (e) {
                console.log('loaded');
                _this.loaded = true;
                _this.loading = false;
                callback();
            }, false);
            el.src = 'https://www.dropbox.com/static/api/2/dropins.js';
            var headEl = document.getElementsByTagName('head')[0];
            headEl.appendChild(el);
        };
        return DropboxChooser;
    })(ExternalChooser);
    Carbon.DropboxChooser = DropboxChooser;
})(Carbon || (Carbon = {}));
