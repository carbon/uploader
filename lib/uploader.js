var Carbon;
(function (Carbon) {
    "use strict";
    var Progress = (function () {
        function Progress(loaded, total) {
            this.loaded = loaded;
            this.total = total;
        }
        Object.defineProperty(Progress.prototype, "value", {
            get: function () {
                return (this.total != 0) ? this.loaded / this.total : 0;
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
            var el = $(element)[0];
            this.barEl = el.querySelector('.bar');
            this.percentEl = el.querySelector('.percent');
            this.inversed = this.barEl.classList.contains('inversed');
        }
        ProgressMeter.prototype.observe = function (manager) {
            manager.progress(this.update.bind(this));
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
            this.element = $(element);
            this.width = this.element.width();
            this.meter = new ProgressMeter(this.element[0]);
        }
        BatchProgressMeter.prototype.observe = function (manager) {
            var _this = this;
            manager.progress(this.meter.update.bind(this.meter));
            manager.on('queued', function (e) {
                _this.setUploads(e.uploads);
            });
        };
        BatchProgressMeter.prototype.reset = function () {
            this.meter.reset();
        };
        BatchProgressMeter.prototype.setUploads = function (files) {
            this.width = this.element.width();
            var condenceWidth = 50;
            var colaposedWidth = 20;
            var condencedPercent = (condenceWidth / this.width);
            var colaposedPercent = (colaposedWidth / this.width);
            var filesEl = this.element.find('.files');
            filesEl.html('');
            var totalSize = files.map(function (u) { return u.size; }).reduce(function (c, n) { return c + n; });
            var fileTemplate = Carbon.Template.get('fileTemplate');
            files.forEach(function (upload) {
                upload.batchPercent = upload.size / totalSize;
                if (upload.batchPercent <= condencedPercent) {
                    upload.condenced = true;
                }
            });
            var nonCondeced = files.filter(function (u) { return !u.condenced; });
            files.forEach(function (upload) {
                if (nonCondeced.length == 0) {
                    upload.batchPercent = 1 / files.length;
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
            files.forEach(function (file) {
                var fileEl = fileTemplate.render({ name: file.name, size: FileUtil.formatBytes(file.size) });
                fileEl.css('width', (file.batchPercent * 100) + '%');
                if (file.condenced) {
                    fileEl.addClass('condensed');
                }
                fileEl.appendTo(filesEl);
                file.element = fileEl;
                file.done(function (e) { file.element.addClass('completed'); });
            });
        };
        return BatchProgressMeter;
    })();
    Carbon.BatchProgressMeter = BatchProgressMeter;
    var CountdownEvent = (function () {
        function CountdownEvent(initialCount) {
            this.currentCount = initialCount || 0;
            this.defer = new $.Deferred();
            this.defer.promise(this);
        }
        CountdownEvent.prototype.addCount = function () {
            this.currentCount++;
        };
        CountdownEvent.prototype.signal = function () {
            this.currentCount--;
            if (this.currentCount == 0) {
                this.resolve();
            }
        };
        return CountdownEvent;
    })();
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
            if (options === void 0) { options = {}; }
            this.status = UploadStatus.Pending;
            this.subscriptions = [];
            this.completedCount = 0;
            this.canceledCount = 0;
            this.reactive = new Carbon.Reactive();
            this.options = options;
            this.reset();
            this.defer = new $.Deferred();
            this.defer.promise(this);
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
            var upload = new Upload(file, this.options);
            upload.manager = this;
            if (!this.accepts(upload.getFormat())) {
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
            this._trigger({
                type: 'selection',
                queued: batch.queued,
                rejected: batch.rejected
            });
            this._trigger({
                type: 'picked',
                queued: batch.queued,
                rejected: batch.rejected
            });
            return batch;
        };
        UploadManager.prototype.removeUpload = function (upload) {
            this.queue.remove(upload);
            this.uploads.remove(upload);
            this.reactive.trigger({
                type: 'uploadRemoved'
            }, upload);
        };
        UploadManager.prototype.reset = function () {
            this.queue = [];
            this.uploads = [];
            this._progress = new Progress(0, 0);
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
            this.reactive.trigger({ type: 'started' });
            this.uploadNext();
        };
        UploadManager.prototype.uploadNext = function () {
            var _this = this;
            if (this.queue.length == 0) {
                this.status = UploadStatus.Completed;
                this._trigger({
                    type: 'done',
                    uploads: this.uploads
                });
                return;
            }
            var upload = this.queue.shift();
            upload.progress(function () {
                var loaded = 0;
                var total = 0;
                for (var i = 0, len = _this.uploads.length; i < len; i++) {
                    loaded += _this.uploads[i]._progress.loaded;
                    total += _this.uploads[i].size;
                }
                _this._progress.loaded = loaded;
                _this._progress.total = total;
                _this.defer.notify(_this._progress);
            });
            upload.then(function () {
                _this.completedCount++;
                _this.defer.notify(_this._progress);
                setTimeout(_this.uploadNext.bind(_this), 0);
            }, function () {
                _this.canceledCount++;
                _this.defer.notify(_this._progress);
                setTimeout(_this.uploadNext.bind(_this), 0);
            });
            upload.start();
        };
        UploadManager.prototype.cancel = function () {
            this.uploads.forEach(function (u) { u.cancel(); });
            this.status = UploadStatus.Canceled;
            this._trigger({ type: 'canceled' });
        };
        UploadManager.prototype._trigger = function (e, data) {
            this.reactive.trigger(e, data);
        };
        UploadManager.prototype.dispose = function () {
            this.cancel();
        };
        UploadManager.supported = !!(window.File && window.FileList && window.Blob && window.FileReader);
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
            this.reactive = new Carbon.Reactive();
            if (!file)
                throw new Error('file is empty');
            this.file = file;
            this.name = this.file.name;
            this.size = this.file.size;
            this.type = this.file.type;
            this._progress = new Progress(0, this.size);
            this.method = options.method || 'POST';
            this.url = options.url;
            this.baseUri = this.url;
            this.defer = new $.Deferred();
            this.defer.promise(this);
        }
        Upload.prototype.on = function (name, callback) {
            return this.reactive.on(name, callback);
        };
        Upload.prototype.start = function () {
            if (this.status >= 2)
                alert('already started');
            if (this.type.indexOf('image') > -1) {
                this.chunkSize = this.size;
            }
            this.offset = 0;
            this.chunkNumber = 1;
            this.chunkCount = Math.ceil(this.size / this.chunkSize);
            this.next();
            this.status = UploadStatus.Uploading;
            this.reactive.trigger({ type: 'started' });
            return this.defer;
        };
        Upload.prototype.next = function () {
            if (this.offset + 1 >= this.size)
                return;
            if (this.chunkCount > 1) {
                console.log('"' + this.name + '" uploading ' + this.chunkNumber + ' of ' + this.chunkCount + ' chunks.');
            }
            var start = this.offset;
            var end = this.offset + this.chunkSize;
            var data;
            if (this.file.slice) {
                data = this.file.slice(start, end);
            }
            else if (this.file.mozSlice) {
                data = this.file.mozSlice(start, end);
            }
            else if (this.file.webkitSlice) {
                data = this.file.webkitSlice(start, end);
            }
            var chunk = new UploadChunk(this, data);
            chunk.progress(this.onProgress.bind(this));
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
                this.defer.resolve(this.response);
            }
            else {
                this.url = (this.baseUri + this.response.id);
                this.next();
            }
        };
        Upload.prototype.cancel = function () {
            if (this.status == UploadStatus.Canceled)
                return;
            if (this.xhr && this.status != 4) {
                this.xhr.abort();
            }
            this.status = UploadStatus.Canceled;
            this.reactive.trigger({ type: 'canceled' });
            this.defer.reject();
            if (this.manager) {
                this.manager.removeUpload(this);
            }
        };
        Upload.prototype.onProgress = function (e) {
            this._progress.loaded = e.loaded + this.offset;
            this.reactive.trigger({
                type: 'progress'
            }, this._progress);
            this.defer.notify(this._progress);
        };
        Upload.prototype.onError = function (e) {
            console.log('upload error', e);
            this.status = UploadStatus.Error;
            this.error = true;
            this.defer.reject();
        };
        Upload.prototype.onAbort = function (e) {
            this.status = UploadStatus.Canceled;
            this.reactive.trigger({ type: 'aborted' });
            this.defer.reject();
        };
        Upload.prototype.onChange = function (transport) {
            if (this.xhr.readyState !== 4) { }
        };
        Upload.prototype.getFormat = function () {
            return FileUtil.getFormatFromName(this.name).toLowerCase();
        };
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
            this.status = 1;
            this.file = file;
            this.data = data;
            this.size = data.size;
            this.offset = file.offset;
            this.number = file.chunkNumber;
            if (this.size == 0)
                throw new Error('No data');
            this._progress = new Progress(0, this.data.size);
            this.defer = new $.Deferred();
            this.defer.promise(this);
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
            xhr.setRequestHeader('X-Chunk-Offset', this.offset);
            xhr.setRequestHeader('X-Chunk-Size', this.size);
            xhr.setRequestHeader('X-Chunk-Number', this.number);
            xhr.send(this.data);
            this.xhr = xhr;
            this.status = UploadStatus.Uploading;
            return this.defer;
        };
        UploadChunk.prototype.onProgress = function (e) {
            if (!e.lengthComputable)
                return;
            this._progress.loaded = e.loaded;
            this.defer.notify(this._progress);
        };
        UploadChunk.prototype.onLoad = function (e) {
            var xhr = e.target;
            if (xhr.readyState !== 4) {
                this.onError(e);
                return;
            }
            this.status = xhr.status;
            this.response = xhr.response;
            if (xhr.responseText) {
                this.response = JSON.parse(xhr.responseText);
            }
            this.status = 3;
            if (xhr.status == 201) {
            }
            this._progress.loaded = this.size;
            this.defer.notify(this._progress);
            this.defer.resolve(this);
        };
        UploadChunk.prototype.onError = function (e) {
            this.error = true;
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
            if (files.length > 0) {
                Carbon.Reactive.trigger('drop', {
                    files: files,
                    items: items,
                    element: dropElement
                });
            }
            if (dropElement) {
                $(dropElement).triggerHandler({
                    type: 'dropped',
                    items: items,
                    files: files
                });
                dropElement.classList.remove('dragOver');
            }
        };
        DropHandler.prototype.getDropElement = function (target) {
            if (target.getAttribute('on-drop') || target.getAttribute('carbon-drop'))
                return target;
            for (var i = 0; i < 5; i++) {
                target = target.parentElement;
                if (!target)
                    return null;
                if (target.getAttribute('on-drop') || target.getAttribute('carbon-drop'))
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
            if (options === void 0) { options = {}; }
            this.reactive = new Carbon.Reactive();
            this.element = $(element);
            this.options = options;
            if (this.element.hasClass('setup'))
                return;
            this.element.addClass('setup');
            if (!this.element.attr('on-drop')) {
                this.element.attr('on-drop', 'pass');
            }
            this.element.on('dropped', this.onDropped.bind(this));
        }
        FileDrop.prototype.subscribe = function (callback) {
            return this.reactive.subscribe(callback);
        };
        FileDrop.prototype.clear = function () { };
        FileDrop.prototype.setAccept = function (formats) {
            this.options.accept = formats;
        };
        FileDrop.prototype.onDropped = function (e) {
            this.reactive.trigger(e.files);
        };
        return FileDrop;
    })();
    Carbon.FileDrop = FileDrop;
    var FileInput = (function () {
        function FileInput(element, options) {
            this.reactive = new Carbon.Reactive();
            this.element = $(element);
            if (this.element.length == 0)
                throw new Error('File input element not found');
            this.element[0].addEventListener('change', this.onChange.bind(this), false);
            if (options && options.accept) {
                this.element.attr('accept', options.accept);
            }
            if (options && options.multiple) {
                this.element.attr('multiple', 'true');
            }
        }
        FileInput.prototype.subscribe = function (callback) {
            return this.reactive.subscribe(callback);
        };
        FileInput.prototype.clear = function () {
            var ua = navigator.userAgent;
            if (ua && ua.indexOf('MSIE') === -1) {
                this.element.val('');
            }
        };
        FileInput.prototype.setAccept = function (formats) {
            this.element.attr('accept', formats.map(function (f) { return '.' + f; }).join(','));
        };
        FileInput.prototype.onChange = function (e) {
            var files = this.element[0].files;
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
            var _this = this;
            var defer = new $.Deferred();
            if (this.loaded) {
                defer.resolve(this.image);
                return defer;
            }
            var reader = new FileReader();
            reader.onloadend = function () {
                _this.image.src = reader.result;
                _this.image.onload = function () {
                    _this.loaded = true;
                    defer.resolve(_this.image);
                };
                _this.image.onerror = function () {
                    defer.reject();
                };
            };
            reader.onerror = function () {
                defer.reject();
            };
            reader.readAsDataURL(this.file);
            return defer;
        };
        FilePreview.prototype.resize = function (maxWidth, maxHeight) {
            // TODO: Apply EXIF rotation
            var defer = new $.Deferred();
            this.load().then(function (image) {
                var size = Util.fitIn(image.width, image.height, maxWidth, maxHeight);
                var canvas = document.createElement('canvas');
                canvas.width = size.width;
                canvas.height = size.height;
                var ctx = canvas.getContext("2d");
                ctx.drawImage(image, 0, 0, size.width, size.height);
                var data = canvas.toDataURL('image/png');
                defer.resolve({
                    width: size.width,
                    height: size.height,
                    data: data,
                    url: data
                });
            });
            return defer;
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
            this._progress = new Progress(0, 100);
            this.reactive = new Carbon.Reactive();
            this.url = url;
            this.status = 0;
            var format = this.url.substring(this.url.lastIndexOf('.') + 1);
            this.type = fileFormats[format] + '/' + format;
            this.defer = new $.Deferred();
            this.defer.promise(this);
        }
        UrlUpload.prototype.onProgress = function (e) {
            var _this = this;
            this._progress.loaded = e.loaded;
            this.defer.notify(this._progress);
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
            var ajax = $.post('https://uploads.carbonmade.com/', { url: this.url });
            ajax.then(this.onDone.bind(this));
            this.onProgress({ loaded: this._progress.loaded + 1 });
            this.reactive.trigger({ type: 'started' });
            return this.defer;
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
