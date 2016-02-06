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
        ExternalChooser.prototype.loadScript = function () {
            return Promise.resolve(true);
        };
        ;
        ExternalChooser.prototype.open = function () {
            if (!this.loaded) {
                this.loadScript().then(this._open.bind(this));
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
        function DropboxChooser(key, options) {
            _super.call(this);
            this.key = key || '3ta2xeuzehs6pob';
            if (options && options.accept) {
                this.accept = options.accept;
            }
        }
        DropboxChooser.prototype._open = function () {
            this.loaded = true;
            var options = {
                linkType: 'direct',
                multiselect: true,
                success: this.onSelection.bind(this),
                cancel: this.onCancel.bind(this)
            };
            if (this.accept) {
                options.extensions = this.accept.map(function (f) { return '.' + f; });
            }
            Dropbox.choose(options);
        };
        DropboxChooser.prototype.setAccept = function (formats) {
            this.accept = formats;
        };
        DropboxChooser.prototype.onCancel = function () { };
        DropboxChooser.prototype.onSelection = function (files) {
            var uploads = files.map(function (file) {
                var upload = new Carbon.UrlUpload(file.link);
                upload.size = file.size;
                upload.name = file.name;
                upload.source = 'dropbox';
                upload.thumbnailUrl = file.thumbnailLink;
                return upload;
            });
            this.reactive.trigger(uploads);
        };
        DropboxChooser.prototype.loadScript = function () {
            var _this = this;
            if (this.loaded)
                return Promise.resolve(true);
            console.log('loading dropbox');
            this.loading = true;
            return new Promise(function (resolve, reject) {
                var el = document.createElement('script');
                el.id = "dropboxjs";
                el.async = true;
                el.setAttribute('data-app-key', _this.key);
                el.addEventListener('load', function (e) {
                    _this.loaded = true;
                    _this.loading = false;
                    resolve();
                }, false);
                el.src = 'https://www.dropbox.com/static/api/2/dropins.js';
                var headEl = document.getElementsByTagName('head')[0];
                headEl.appendChild(el);
            });
        };
        return DropboxChooser;
    })(ExternalChooser);
    Carbon.DropboxChooser = DropboxChooser;
})(Carbon || (Carbon = {}));
