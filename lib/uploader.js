"use strict";
var Carbon;
(function (Carbon) {
    var Progress = (function () {
        function Progress(loaded, total) {
            this.loaded = loaded;
            this.total = total;
            this.loaded = loaded;
            this.total = total;
        }
        Object.defineProperty(Progress.prototype, "value", {
            get: function () {
                return this.total !== 0 ? (this.loaded / this.total) : 0;
            },
            enumerable: true,
            configurable: true
        });
        Progress.prototype.toString = function () {
            return Math.round(this.value * 100) + "%";
        };
        return Progress;
    })();
    Carbon.Progress = Progress;
    var ProgressMeter = (function () {
        function ProgressMeter(element) {
            this.barEl = element.querySelector('.bar');
            this.percentEl = element.querySelector('.percent');
            this.inversed = this.barEl.classList.contains('inversed');
        }
        ProgressMeter.prototype.observe = function (manager) {
            manager.on('progress', this.update.bind(this));
        };
        ProgressMeter.prototype.reset = function () {
            this.barEl.style.width = '0%';
            this.percentEl.innerHTML = '0%';
        };
        ProgressMeter.prototype.update = function (progress) {
            this.setValue(progress.value);
        };
        ProgressMeter.prototype.setValue = function (value) {
            var percent = Math.round(value * 100);
            if (this.inversed)
                percent = 100 - percent;
            this.barEl.style.width = percent + '%';
            if (this.percentEl) {
                this.percentEl.innerHTML = percent + '%';
            }
        };
        return ProgressMeter;
    })();
    Carbon.ProgressMeter = ProgressMeter;
    var BatchProgressMeter = (function () {
        function BatchProgressMeter(element) {
            this.element = element;
            this.width = $(element).width();
            console.log(this.width, this.element.clientWidth);
            this.meter = new ProgressMeter(this.element);
        }
        BatchProgressMeter.prototype.observe = function (manager) {
            var _this = this;
            manager.on('progress', this.meter.update.bind(this.meter));
            manager.on('queue', function (e) {
                _this.setUploads(e.uploads);
            });
        };
        BatchProgressMeter.prototype.reset = function () {
            this.meter.reset();
        };
        BatchProgressMeter.prototype.setUploads = function (uploads) {
            this.width = $(this.element).width();
            var condenceWidth = 50;
            var colaposedWidth = 20;
            var condencedPercent = (condenceWidth / this.width);
            var colaposedPercent = (colaposedWidth / this.width);
            var filesEl = this.element.querySelector('.files');
            filesEl.innerHTML = '';
            var totalSize = uploads.map(function (u) { return u.size; }).reduce(function (c, n) { return c + n; });
            var fileTemplate = Carbon.Template.get('fileTemplate');
            uploads.forEach(function (upload) {
                upload.batchPercent = upload.size / totalSize;
                if (upload.batchPercent <= condencedPercent) {
                    upload.condenced = true;
                }
            });
            var nonCondeced = files.filter(function (u) { return !u.condenced; });
            uploads.forEach(function (upload) {
                if (nonCondeced.length == 0) {
                    upload.batchPercent = 1 / uploads.length;
                }
                else if (upload.condenced) {
                    var toGive = upload.batchPercent - colaposedPercent;
                    upload.batchPercent = colaposedPercent;
                    upload.condenced = true;
                    var distribution = toGive / nonCondeced.length;
                    nonCondeced.forEach(function (b) {
                        b.batchPercent += distribution;
                    });
                }
            });
            uploads.forEach(function (file) {
                var fileEl = fileTemplate.render({
                    name: file.name,
                    size: FileUtil.formatBytes(file.size)
                });
                fileEl.style.width = (file.batchPercent * 100) + '%';
                if (file.condenced) {
                    fileEl.classList.add('condensed');
                }
                filesEl.appendChild(fileEl);
                file.element = fileEl;
                file.defer.promise.then(function (e) {
                    file.element.addClass('completed');
                });
            });
        };
        return BatchProgressMeter;
    })();
    Carbon.BatchProgressMeter = BatchProgressMeter;
    var UploadBatch = (function () {
        function UploadBatch() {
            this.queued = [];
            this.rejected = [];
        }
        return UploadBatch;
    })();
    Carbon.UploadBatch = UploadBatch;
    var UploadManager = (function () {
        function UploadManager(options) {
            this.status = UploadStatus.Pending;
            this.subscriptions = [];
            this.completedCount = 0;
            this.canceledCount = 0;
            this.debug = false;
            this.reactive = new Carbon.Reactive();
            this.options = options || { url: '' };
            this.reset();
            this.debug = this.options.debug || false;
            this.uploadLimit = options.uploadLimit || 1000;
            this.accept = options.accept;
            if (this.uploadLimit < 0) {
                this.uploadLimit = 0;
            }
            if (this.options.inputs) {
                for (var i = 0; i < this.options.inputs.length; i++) {
                    this.addSource(this.options.inputs[i]);
                }
            }
        }
        UploadManager.prototype.on = function (nameOrObject, callback) {
            // { type: function, type: function } ...
            if (typeof nameOrObject == 'object') {
                var keys = Object.keys(nameOrObject);
                for (var i = 0; i < keys.length; i++) {
                    var key = keys[i];
                    this.reactive.on(key, nameOrObject[key]);
                }
            }
            else {
                return this.reactive.on(nameOrObject, callback);
            }
        };
        UploadManager.prototype.addSource = function (source) {
            // sources may be file inputs or drops
            if (this.accept && source.setAccept) {
                source.setAccept(this.accept);
            }
            var subscription = source.subscribe(this.addFiles.bind(this));
            this.subscriptions.push(subscription);
        };
        UploadManager.prototype.accepts = function (format) {
            if (!this.options.accept)
                return true;
            return this.options.accept.filter(function (f) { return f == format; }).length > 0;
        };
        UploadManager.prototype.queueFile = function (file) {
            var _this = this;
            var upload = new Upload(file, this.options);
            if (!this.accepts(upload.format)) {
                upload.rejected = true;
                upload.rejectionReason = 'Unsupported';
            }
            else if (this.uploads.length >= this.uploadLimit) {
                upload.rejected = true;
                upload.rejectionReason = 'Over limit';
            }
            else {
                this.queue.push(upload);
                this.uploads.push(upload);
            }
            upload.on('cancel', function () {
                console.log('upload canceled', _this);
                _this.removeUpload(upload);
            });
            return upload;
        };
        UploadManager.prototype.addFiles = function (files) {
            var batch = new UploadBatch();
            if (!files || files.length == 0)
                return batch;
            for (var i = 0, len = files.length; i < len; i++) {
                var upload = this.queueFile(files[i]);
                if (upload.rejected) {
                    batch.rejected.push(upload);
                }
                else {
                    batch.queued.push(upload);
                }
            }
            this.reactive.trigger({
                type: 'add',
                queued: batch.queued,
                rejected: batch.rejected
            });
            return batch;
        };
        UploadManager.prototype.removeUpload = function (upload) {
            this.queue.remove(upload);
            this.uploads.remove(upload);
            this.reactive.trigger({
                type: 'remove'
            }, upload);
        };
        UploadManager.prototype.reset = function () {
            this.queue = [];
            this.uploads = [];
            this.progress = new Progress(0, 0);
            this.completedCount = 0;
            this.canceledCount = 0;
            if (this.options.inputs) {
                this.options.inputs.forEach(function (u) { u.clear(); });
            }
        };
        UploadManager.prototype.setUploadLimit = function (value) {
            this.uploadLimit = value;
            if (this.debug) {
                console.log('Upload limit set: ' + value);
            }
        };
        UploadManager.prototype.start = function () {
            this.status = UploadStatus.Uploading;
            this.reactive.trigger({
                type: 'start',
                instance: this
            });
            this.uploadNext();
        };
        UploadManager.prototype.uploadNext = function () {
            var _this = this;
            if (this.queue.length == 0) {
                this.status = UploadStatus.Completed;
                this.reactive.trigger({
                    type: 'complete',
                    instance: this,
                    uploads: this.uploads
                });
                return;
            }
            var upload = this.queue.shift();
            upload.on('progress', function (e) {
                var loaded = 0;
                var total = 0;
                for (var _i = 0, _a = _this.uploads; _i < _a.length; _i++) {
                    var upload = _a[_i];
                    loaded += upload.progress.loaded;
                    total += upload.size;
                }
                _this.progress.loaded = loaded;
                _this.progress.total = total;
                _this.notify();
            });
            upload.start().then(function () {
                console.log('upload completed');
                _this.completedCount++;
                _this.notify();
                _this.uploadNext();
            }, function () {
                _this.canceledCount++;
                _this.notify();
                _this.uploadNext();
            });
        };
        UploadManager.prototype.notify = function () {
            this.reactive.trigger({
                type: 'progress',
                loaded: this.progress.loaded,
                total: this.progress.total,
                value: this.progress.value
            });
        };
        UploadManager.prototype.cancel = function () {
            this.uploads.forEach(function (u) { u.cancel(); });
            this.status = UploadStatus.Canceled;
            this.reactive.trigger({ type: 'cancel' });
        };
        UploadManager.prototype.dispose = function () {
            this.cancel();
        };
        return UploadManager;
    })();
    Carbon.UploadManager = UploadManager;
    var UploadStatus;
    (function (UploadStatus) {
        UploadStatus[UploadStatus["Pending"] = 1] = "Pending";
        UploadStatus[UploadStatus["Uploading"] = 2] = "Uploading";
        UploadStatus[UploadStatus["Completed"] = 3] = "Completed";
        UploadStatus[UploadStatus["Canceled"] = 4] = "Canceled";
        UploadStatus[UploadStatus["Error"] = 5] = "Error";
    })(UploadStatus || (UploadStatus = {}));
    var Upload = (function () {
        function Upload(file, options) {
            this.status = UploadStatus.Pending;
            this.retryCount = 0;
            this.debug = false;
            this.chunkSize = 5242880;
            this.rejected = false;
            this.reactive = new Carbon.Reactive();
            this.defer = new _.Deferred();
            if (!file)
                throw new Error('file is empty');
            this.file = file;
            this.name = this.file.name;
            this.size = this.file.size;
            this.type = this.file.type;
            this.progress = new Progress(0, this.size);
            this.method = options.method || 'POST';
            this.url = options.url;
            this.baseUri = this.url;
            this.promise = this.defer.promise;
        }
        Upload.prototype.on = function (name, callback) {
            return this.reactive.on(name, callback);
        };
        Upload.prototype.start = function () {
            if (this.status >= 2) {
                return Promise.reject('[Upload] already started');
            }
            if (this.type.indexOf('image') > -1) {
                this.chunkSize = this.size;
            }
            this.offset = 0;
            this.chunkNumber = 1;
            this.chunkCount = Math.ceil(this.size / this.chunkSize);
            this.next();
            this.status = UploadStatus.Uploading;
            this.reactive.trigger({ type: 'start' });
            return this.defer.promise;
        };
        Upload.prototype.next = function () {
            if (this.offset + 1 >= this.size)
                return;
            if (this.chunkCount > 1) {
                console.log("'" + this.name + "' uploading " + this.chunkNumber + " of " + this.chunkCount + " chunks.");
            }
            var start = this.offset;
            var end = this.offset + this.chunkSize;
            var data;
            if (this.file.slice) {
                data = this.file.slice(start, end);
            }
            else if (this.file.webkitSlice) {
                data = this.file.webkitSlice(start, end);
            }
            var chunk = new UploadChunk(this, data);
            chunk.onprogress = this.onProgress.bind(this);
            chunk.send(this).then(this.onChunkUploaded.bind(this), this.onChunkFailed.bind(this));
        };
        Upload.prototype.onChunkFailed = function (chunk) {
            if (this.debug) {
                console.log('Chunk failed, auto retrying in 1s. ' + this.retryCount + ' of 3.');
            }
            if (this.retryCount < 3) {
                this.retryCount++;
                setTimeout(this.next.bind(this), 1000);
            }
            else {
                this.onError(chunk);
            }
        };
        Upload.prototype.onChunkUploaded = function (chunk) {
            this.chunkNumber++;
            this.offset += chunk.size;
            this.response = chunk.response;
            this.id = chunk.response.id;
            this.retryCount = 0;
            if (this.offset == this.size) {
                console.log('file uploaded', chunk);
                this.reactive.trigger({ type: 'complete' });
                this.defer.resolve(this.response);
            }
            else {
                this.url = (this.baseUri + this.response.id);
                this.next();
            }
        };
        Upload.prototype.onProgress = function (e) {
            this.progress.loaded = e.loaded + this.offset;
            this.reactive.trigger({
                type: 'progress',
                loaded: this.progress.loaded,
                total: this.progress.total,
                value: this.progress.value
            });
        };
        Upload.prototype.onError = function (e) {
            console.log('upload error', e);
            this.status = UploadStatus.Error;
            this.defer.reject();
        };
        Upload.prototype.onAbort = function (e) {
            this.status = UploadStatus.Canceled;
            this.reactive.trigger({ type: 'abort' });
            this.defer.reject();
        };
        Upload.prototype.cancel = function () {
            if (this.status == UploadStatus.Canceled)
                return;
            if (this.xhr && this.status != 4) {
                this.xhr.abort();
            }
            this.status = UploadStatus.Canceled;
            this.reactive.trigger({ type: 'cancel' });
            this.defer.reject();
        };
        Upload.prototype.onChange = function (transport) {
            if (this.xhr.readyState !== 4) { }
        };
        Object.defineProperty(Upload.prototype, "format", {
            get: function () {
                return FileUtil.getFormatFromName(this.name).toLowerCase();
            },
            enumerable: true,
            configurable: true
        });
        Upload.prototype.getFormattedSize = function () {
            return FileUtil.formatBytes(this.size);
        };
        Upload.prototype.getPreview = function () {
            return new FilePreview(this.file);
        };
        return Upload;
    })();
    Carbon.Upload = Upload;
    var UploadChunk = (function () {
        function UploadChunk(file, data) {
            this.status = UploadStatus.Pending;
            this.defer = new _.Deferred();
            if (data.size == 0)
                throw new Error('[Upload] data.size has no data');
            this.file = file;
            this.data = data;
            this.size = data.size;
            this.offset = file.offset;
            this.number = file.chunkNumber;
            this.progress = new Progress(0, this.data.size);
        }
        UploadChunk.prototype.send = function (options) {
            var xhr = new XMLHttpRequest();
            xhr.addEventListener('load', this.onLoad.bind(this), false);
            xhr.addEventListener('error', this.onError.bind(this), false);
            xhr.addEventListener('abort', this.onAbort.bind(this), false);
            xhr.upload.addEventListener('progress', this.onProgress.bind(this), false);
            xhr.open(options.method, options.url, true);
            xhr.setRequestHeader('Content-Type', 'text/plain');
            xhr.setRequestHeader('X-File-Name', encodeURI(this.file.name));
            xhr.setRequestHeader('X-File-Type', this.file.type.replace('//', '/'));
            xhr.setRequestHeader('X-File-Size', this.file.size);
            xhr.setRequestHeader('X-Chunk-Count', this.file.chunkCount);
            xhr.setRequestHeader('X-Chunk-Offset', this.offset.toString());
            xhr.setRequestHeader('X-Chunk-Size', this.size.toString());
            xhr.setRequestHeader('X-Chunk-Number', this.number.toString());
            xhr.send(this.data);
            this.status = UploadStatus.Uploading;
            return this.defer.promise;
        };
        UploadChunk.prototype.onProgress = function (e) {
            if (!e.lengthComputable)
                return;
            this.progress.loaded = e.loaded;
            if (this.onprogress)
                this.onprogress(this.progress);
        };
        UploadChunk.prototype.onLoad = function (e) {
            console.log('loaded chuck', e);
            var xhr = e.target;
            if (xhr.readyState !== 4) {
                this.onError(e);
                return;
            }
            this.response = JSON.parse(xhr.responseText);
            this.status = UploadStatus.Completed;
            if (xhr.status == 201) {
            }
            this.progress.loaded = this.size;
            if (this.onprogress)
                this.onprogress(this.progress);
            this.defer.resolve(this);
        };
        UploadChunk.prototype.onError = function (e) {
            this.status = UploadStatus.Error;
            this.error = e.error;
            this.defer.reject(this);
        };
        UploadChunk.prototype.onAbort = function (e) {
            this.status = UploadStatus.Canceled;
            this.defer.reject(this);
        };
        return UploadChunk;
    })();
    var DropHandler = (function () {
        function DropHandler() {
            var el = document.body;
            el.addEventListener('dragenter', this.onDragEnter.bind(this), false);
            el.addEventListener('dragover', this.onDragOver.bind(this), false);
            el.addEventListener('dragleave', this.onDragLeave.bind(this), false);
            el.addEventListener('drop', this.onDrop.bind(this), false);
            this.currentDropElement = null;
        }
        DropHandler.prototype.onDragEnter = function (e) {
            // entering target element
            var target = e.target;
            var dropElement = this.getDropElement(target);
            if (dropElement) {
                $('.dragOver').removeClass('dragOver');
                dropElement.classList.add('dragOver');
                this.currentDropElement = dropElement;
            }
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
        };
        DropHandler.prototype.onDragOver = function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        };
        DropHandler.prototype.onDragLeave = function (e) {
            // console.log('enter', e.target);
            if (!this.currentDropElement)
                return;
            var box = this.currentDropElement.getBoundingClientRect();
            if ((e.y < box.top) || (e.y > box.bottom) || (e.x < box.left) || (e.x > box.right)) {
                this.currentDropElement.classList.remove('dragOver');
                this.currentDropElement = null;
            }
        };
        DropHandler.prototype.onDrop = function (e) {
            e.preventDefault();
            var files = e.dataTransfer.files;
            var items = e.dataTransfer.items;
            var dropElement = this.getDropElement(e.target);
            if (dropElement) {
                dropElement.classList.remove('dragOver');
            }
            if (files.length == 0)
                return;
            var detail = {
                files: files,
                items: items,
                element: dropElement || document.body
            };
            _.trigger(detail.element, 'carbon:drop', detail);
        };
        DropHandler.prototype.getDropElement = function (target) {
            if (target.getAttribute('on-drop'))
                return target;
            for (var i = 0; i < 5; i++) {
                target = target.parentElement;
                if (!target)
                    return null;
                if (target.getAttribute('on-drop'))
                    return target;
            }
            return null;
        };
        DropHandler.instance = new DropHandler();
        return DropHandler;
    })();
    Carbon.DropHandler = DropHandler;
    var FileDrop = (function () {
        function FileDrop(element, options) {
            var _this = this;
            if (options === void 0) { options = {}; }
            this.reactive = new Carbon.Reactive();
            if (typeof element === 'string') {
                this.element = document.querySelector(element);
            }
            else {
                this.element = element;
            }
            if (!this.element)
                throw new Error('[FileDrop] element not found');
            console.log(this.element);
            this.options = options;
            if (this.element.classList.contains('setup'))
                return;
            this.element.classList.add('setup');
            if (!this.element.getAttribute('on-drop')) {
                this.element.setAttribute('on-drop', 'pass');
            }
            this.element.addEventListener('carbon:drop', function (e) {
                _this.reactive.trigger(e.detail.files);
            });
        }
        FileDrop.prototype.subscribe = function (callback) {
            return this.reactive.subscribe(callback);
        };
        FileDrop.prototype.clear = function () { };
        FileDrop.prototype.setAccept = function (formats) {
            this.options.accept = formats;
        };
        return FileDrop;
    })();
    Carbon.FileDrop = FileDrop;
    var FileInput = (function () {
        function FileInput(element, options) {
            this.reactive = new Carbon.Reactive();
            if (typeof element === 'string') {
                this.element = document.querySelector(element);
            }
            else {
                this.element = element;
            }
            if (!this.element)
                throw new Error('[FileInput] element not found');
            this.element.addEventListener('change', this.onChange.bind(this), false);
            if (options) {
                if (options.accept) {
                    this.element.setAttribute('accept', options.accept);
                }
                if (options.multiple) {
                    this.element.setAttribute('multiple', 'true');
                }
            }
        }
        FileInput.prototype.subscribe = function (callback) {
            return this.reactive.subscribe(callback);
        };
        FileInput.prototype.clear = function () {
            var ua = navigator.userAgent;
            if (ua && ua.indexOf('MSIE') === -1) {
                this.element.value = '';
            }
        };
        FileInput.prototype.setAccept = function (formats) {
            this.element.setAttribute('accept', formats.map(function (f) { return '.' + f; }).join(','));
        };
        FileInput.prototype.onChange = function (e) {
            var files = this.element.files;
            if (files.length == 0)
                return;
            this.reactive.trigger(files);
        };
        return FileInput;
    })();
    Carbon.FileInput = FileInput;
    var FilePreview = (function () {
        function FilePreview(file) {
            this.loaded = false;
            this.file = file;
            this.type = file.type;
            this.image = new Image();
        }
        FilePreview.prototype.getURL = function () {
            if (this.type.indexOf('image') < 0) {
                console.log('Expected image. Was ' + this.type);
            }
            ;
            var URL = window.URL && window.URL.createObjectURL ? window.URL :
                window.webkitURL && window.webkitURL.createObjectURL ? window.webkitURL : null;
            return URL.createObjectURL(this.file);
        };
        FilePreview.prototype.load = function () {
            // TODO: Subsample images in iOS
            if (this.loaded) {
                return Promise.resolve(this.image);
            }
            return new Promise(function (resolve, reject) {
                var _this = this;
                var reader = new FileReader();
                reader.onloadend = function () {
                    _this.image.src = reader.result;
                    _this.image.onload = function () {
                        _this.loaded = true;
                        resolve(_this.image);
                    };
                    _this.image.onerror = function () {
                        reject();
                    };
                };
                reader.onerror = function () {
                    reject();
                };
                reader.readAsDataURL(this.file);
            });
        };
        FilePreview.prototype.resize = function (maxWidth, maxHeight) {
            // TODO: Apply EXIF rotation
            return this.load().then(function (image) {
                var size = Util.fitIn(image.width, image.height, maxWidth, maxHeight);
                var canvas = document.createElement('canvas');
                canvas.width = size.width;
                canvas.height = size.height;
                var ctx = canvas.getContext("2d");
                ctx.drawImage(image, 0, 0, size.width, size.height);
                var data = canvas.toDataURL('image/png');
                return Promise.resolve({
                    width: size.width,
                    height: size.height,
                    data: data,
                    url: data
                });
            });
        };
        return FilePreview;
    })();
    Carbon.FilePreview = FilePreview;
    var Util = {
        fitIn: function (width, height, maxWidth, maxHeight) {
            if (height <= maxHeight && width <= maxWidth) {
                return { width: width, height: height };
            }
            var mutiplier = (maxWidth / width);
            if (height * mutiplier <= maxHeight) {
                return {
                    width: maxWidth,
                    height: Math.round(height * mutiplier)
                };
            }
            else {
                var mutiplier = (maxHeight / height);
                return {
                    width: Math.round(width * mutiplier),
                    height: maxHeight
                };
            }
        }
    };
    var FileUtil = {
        scales: ['B', 'KB', 'MB', 'GB'],
        getFormatFromName: function (name) {
            var split = name.split('.');
            return split[split.length - 1];
        },
        threeNonZeroDigits: function (value) {
            if (value >= 100)
                return parseInt(value, 10);
            if (value >= 10) {
                return Math.round(value * 10) / 10;
            }
            else {
                return Math.round(value * 100) / 100;
            }
        },
        formatBytes: function (byteCount) {
            var i = 0;
            var base = 1000;
            var value = byteCount;
            while ((base - 1) < value) {
                value /= base;
                i++;
            }
            return FileUtil.threeNonZeroDigits(value) + " " + FileUtil.scales[i];
        }
    };
    window.FileUtil = FileUtil;
    var fileFormats = {
        aac: 'audio',
        aiff: 'audio',
        flac: 'audio',
        m4a: 'audio',
        mp3: 'audio',
        oga: 'audio',
        wav: 'audio',
        wma: 'audio',
        bmp: 'image',
        jpg: 'image',
        jpeg: 'image',
        gif: 'image',
        ico: 'image',
        png: 'image',
        psd: 'image',
        svg: 'image',
        tif: 'image',
        tiff: 'image',
        avi: 'video',
        f4v: 'video',
        flv: 'video',
        mkv: 'video',
        mv4: 'video',
        mpg: 'video',
        mpeg: 'video',
        mov: 'video',
        mp4: 'video',
        ogg: 'video',
        ogv: 'video',
        qt: 'video',
        webm: 'video',
        wmv: 'video',
        ai: 'application',
        pdf: 'application',
        swf: 'application'
    };
    ;
    var UrlUpload = (function () {
        function UrlUpload(url) {
            this.progress = new Progress(0, 100);
            this.defer = new _.Deferred();
            this.reactive = new Carbon.Reactive();
            this.url = url;
            this.status = 0;
            var format = this.url.substring(this.url.lastIndexOf('.') + 1);
            this.type = fileFormats[format] + '/' + format;
            this.promise = this.defer.promise;
        }
        UrlUpload.prototype.onProgress = function (e) {
            var _this = this;
            this.progress.loaded = e.loaded;
            this.reactive.trigger({
                type: 'progress',
                loaded: this.progress.loaded,
                total: this.progress.total,
                value: this.progress.value
            });
            if (e.loaded < 100) {
                setTimeout(function () {
                    _this.onProgress({ loaded: e.loaded + 1 });
                }, 10);
            }
        };
        UrlUpload.prototype.on = function (name, callback) {
            this.reactive.on(name, callback);
        };
        UrlUpload.prototype.start = function () {
            var request = fetch('https://uploads.carbonmade.com/', {
                mode: 'cors',
                method: 'POST',
                body: "url=" + this.url,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }).then(function (response) { return response.json(); });
            request.then(this.onDone.bind(this));
            this.onProgress({ loaded: this.progress.loaded });
            this.reactive.trigger({ type: 'start' });
            return this.defer.promise;
        };
        UrlUpload.prototype.onDone = function (data) {
            this.status = UploadStatus.Completed;
            this.response = data;
            this.defer.resolve(data);
        };
        return UrlUpload;
    })();
    Carbon.UrlUpload = UrlUpload;
})(Carbon || (Carbon = {}));
var _;
(function (_) {
    var Deferred = (function () {
        function Deferred() {
            var _this = this;
            this.promise = new Promise(function (resolve, reject) {
                _this._resolve = resolve;
                _this._reject = reject;
            });
        }
        Deferred.prototype.resolve = function (value) {
            this._resolve(value);
        };
        Deferred.prototype.reject = function (value) {
            this._reject(value);
        };
        return Deferred;
    })();
    _.Deferred = Deferred;
    function trigger(element, name, detail) {
        return element.dispatchEvent(new CustomEvent(name, {
            bubbles: true,
            detail: detail
        }));
    }
    _.trigger = trigger;
})(_ || (_ = {}));
