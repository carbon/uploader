"use strict";
var Carbon;
(function (Carbon) {
    class Progress {
        constructor(loaded, total) {
            this.loaded = loaded;
            this.total = total;
            this.loaded = loaded;
            this.total = total;
        }
        get value() {
            return this.total !== 0 ? (this.loaded / this.total) : 0;
        }
        toString() {
            return Math.round(this.value * 100) + "%";
        }
    }
    Carbon.Progress = Progress;
    class ProgressMeter {
        constructor(element) {
            this.barEl = element.querySelector('.bar');
            this.percentEl = element.querySelector('.percent');
        }
        get inversed() {
            return this.barEl.classList.contains('inversed');
        }
        observe(manager) {
            manager.on('progress', this.update.bind(this));
        }
        reset() {
            this.barEl.style.width = '0%';
            if (this.percentEl) {
                this.percentEl.innerHTML = '0%';
            }
        }
        update(progress) {
            this.setValue(progress.value);
        }
        setValue(value) {
            let percent = Math.round(value * 100);
            if (this.inversed)
                percent = 100 - percent;
            this.barEl.style.width = percent + '%';
            if (this.percentEl) {
                this.percentEl.innerHTML = percent + '%';
            }
        }
    }
    Carbon.ProgressMeter = ProgressMeter;
    class BatchProgressMeter {
        constructor(element) {
            this.element = element;
            this.meter = new ProgressMeter(this.element);
        }
        get width() {
            return this.element.clientWidth;
        }
        observe(manager) {
            manager.on('progress', this.meter.update.bind(this.meter));
            manager.on('queue', e => {
                this.setUploads(e.uploads);
            });
        }
        reset() {
            this.meter.reset();
        }
        async setUploads(uploads) {
            let condenceWidth = 50;
            let colaposedWidth = 20;
            let condencedPercent = condenceWidth / this.width;
            let colaposedPercent = colaposedWidth / this.width;
            let filesEl = this.element.querySelector('.files');
            filesEl.innerHTML = '';
            let totalSize = uploads.map(u => u.size).reduce((c, n) => c + n);
            let fileTemplate = Carbon.Template.get('fileTemplate');
            for (var file of uploads) {
                file.batchPercent = file.size / totalSize;
                if (file.batchPercent <= condencedPercent) {
                    file.condenced = true;
                }
            }
            let nonCondeced = uploads.filter((u) => !u.condenced);
            for (var file of uploads) {
                if (nonCondeced.length === 0) {
                    file.batchPercent = 1 / uploads.length;
                }
                else if (file.condenced) {
                    let toGive = file.batchPercent - colaposedPercent;
                    file.batchPercent = colaposedPercent;
                    file.condenced = true;
                    let distribution = toGive / nonCondeced.length;
                    nonCondeced.forEach((b) => {
                        b.batchPercent += distribution;
                    });
                }
            }
            for (var file of uploads) {
                let fileEl = fileTemplate.render({
                    name: file.name,
                    size: FileUtil.formatBytes(file.size)
                });
                fileEl.style.width = (file.batchPercent * 100) + '%';
                if (file.condenced) {
                    fileEl.classList.add('condensed');
                }
                filesEl.appendChild(fileEl);
                file.element = fileEl;
                await file.defer.promise;
                file.element.classList.add('completed');
            }
        }
    }
    Carbon.BatchProgressMeter = BatchProgressMeter;
    class UploadBatch {
        constructor() {
            this.queued = [];
            this.rejected = [];
        }
    }
    Carbon.UploadBatch = UploadBatch;
    class UploadManager {
        constructor(options) {
            this.status = UploadStatus.Pending;
            this.subscriptions = [];
            this.completedCount = 0;
            this.canceledCount = 0;
            this.debug = false;
            this.maxSize = 5000000000;
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
                for (var input of this.options.inputs) {
                    this.addSource(input);
                }
            }
        }
        on(type, callback) {
            return this.reactive.on(type, callback);
        }
        addSource(source) {
            if (this.accept && source.setAccept) {
                source.setAccept(this.accept);
            }
            let subscription = source.subscribe(this.addFiles.bind(this));
            this.subscriptions.push(subscription);
        }
        accepts(format) {
            if (!this.options.accept)
                return true;
            return this.options.accept.filter(f => f === format).length > 0;
        }
        queueFile(file) {
            let upload = file.promise ? file : new Upload(file, this.options);
            if (!this.accepts(upload.format)) {
                upload.rejected = true;
                upload.rejectionReason = 'Unsupported';
            }
            if (upload.size > this.maxSize) {
                upload.rejected = true;
                upload.rejectionReason = 'Too large';
            }
            else if (this.uploads.length >= this.uploadLimit) {
                upload.rejected = true;
                upload.rejectionReason = 'Over limit';
            }
            else {
                this.queue.push(upload);
                this.uploads.push(upload);
            }
            upload.on('cancel', () => {
                console.log('upload canceled', this);
                this.removeUpload(upload);
            });
            return upload;
        }
        addFiles(files) {
            let batch = new UploadBatch();
            if (!files || files.length === 0)
                return batch;
            for (var i = 0, len = files.length; i < len; i++) {
                let upload = this.queueFile(files[i]);
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
        }
        removeUpload(upload) {
            this.queue.remove(upload);
            this.uploads.remove(upload);
            this.reactive.trigger({
                type: 'remove',
                upload: upload
            });
        }
        reset() {
            this.queue = [];
            this.uploads = [];
            this.progress = new Progress(0, 0);
            this.completedCount = 0;
            this.canceledCount = 0;
            if (this.options.inputs) {
                for (var picker of this.options.inputs) {
                    if (picker.clear) {
                        picker.clear();
                    }
                }
            }
        }
        setUploadLimit(value) {
            this.uploadLimit = value;
        }
        async start() {
            this.status = UploadStatus.Uploading;
            this.reactive.trigger({
                type: 'start',
                instance: this
            });
            while (this.queue.length > 0) {
                await this.uploadNext();
                this.onProgress();
            }
            this.status = UploadStatus.Completed;
            this.reactive.trigger({
                type: 'complete',
                instance: this,
                uploads: this.uploads
            });
        }
        async uploadNext() {
            let upload = this.queue.shift();
            upload.on('progress', (e) => {
                var loaded = 0;
                var total = 0;
                for (var upload of this.uploads) {
                    loaded += upload.progress.loaded;
                    total += upload.size;
                }
                this.progress.loaded = loaded;
                this.progress.total = total;
                this.onProgress();
            });
            this.reactive.trigger({
                type: 'upload:start',
                upload: upload
            });
            try {
                await upload.start();
                this.completedCount++;
                this.reactive.trigger({
                    type: 'upload:complete',
                    upload: upload
                });
            }
            catch (err) {
                this.canceledCount++;
                this.reactive.trigger({
                    type: 'upload:error',
                    upload: upload
                });
            }
        }
        onProgress() {
            this.reactive.trigger({
                type: 'progress',
                loaded: this.progress.loaded,
                total: this.progress.total,
                value: this.progress.value
            });
        }
        cancel() {
            for (var upload of this.uploads) {
                upload.cancel();
            }
            this.status = UploadStatus.Canceled;
            this.reactive.trigger({ type: 'cancel' });
        }
        dispose() {
            this.cancel();
        }
    }
    Carbon.UploadManager = UploadManager;
    let UploadStatus;
    (function (UploadStatus) {
        UploadStatus[UploadStatus["Pending"] = 1] = "Pending";
        UploadStatus[UploadStatus["Uploading"] = 2] = "Uploading";
        UploadStatus[UploadStatus["Completed"] = 3] = "Completed";
        UploadStatus[UploadStatus["Canceled"] = 4] = "Canceled";
        UploadStatus[UploadStatus["Error"] = 5] = "Error";
    })(UploadStatus || (UploadStatus = {}));
    class Upload {
        constructor(file, options) {
            this.status = UploadStatus.Pending;
            this.retryCount = 0;
            this.debug = false;
            this.chunkSize = 1024 * 1024 * 32;
            this.rejected = false;
            this.reactive = new Carbon.Reactive();
            this.defer = new Deferred();
            if (!file)
                throw new Error('file is empty');
            this.file = file;
            this.name = this.file.name;
            this.size = this.file.size;
            this.type = this.file.type;
            this.progress = new Progress(0, this.size);
            if (options.chuckSize) {
                this.chunkSize = options.chuckSize;
            }
            this.method = options.method || 'POST';
            this.url = options.url;
            this.baseUri = this.url;
            this.authorization = options.authorization;
            this.promise = this.defer.promise;
        }
        on(name, callback) {
            return this.reactive.on(name, callback);
        }
        async start() {
            if (this.status >= 2) {
                throw new Error('[Upload] already started');
            }
            this.offset = 0;
            this.chunkNumber = 1;
            this.chunkCount = Math.ceil(this.size / this.chunkSize);
            this.status = UploadStatus.Uploading;
            this.reactive.trigger({ type: 'start' });
            try {
                while (this.offset + 1 < this.size) {
                    await this.uploadNextChunk();
                }
            }
            catch (err) {
                this.status = UploadStatus.Error;
                this.reactive.trigger({ type: 'error' });
                this.defer.reject();
                throw (err);
            }
            this.status = UploadStatus.Completed;
            this.reactive.trigger({ type: 'complete' });
            this.defer.resolve(this.result);
            return this.result;
        }
        async uploadNextChunk() {
            if (this.offset + 1 >= this.size) {
                throw new Error('Already reached end');
            }
            if (this.chunkCount > 1) {
                console.log(`'${this.name}' uploading ${this.chunkNumber} of ${this.chunkCount} chunks.`);
            }
            let start = this.offset;
            let end = this.offset + this.chunkSize;
            let data = this.file.slice(start, end);
            let chunk = new UploadChunk(this, data);
            chunk.onprogress = this.onProgress.bind(this);
            await chunk.send(this);
            this.chunkNumber++;
            this.offset += chunk.size;
            this.result = chunk.result;
            this.id = this.result.id;
            if (this.offset != this.size) {
                this.xId = this.result.id;
            }
        }
        onProgress(e) {
            this.progress.loaded = e.loaded + this.offset;
            this.reactive.trigger({
                type: 'progress',
                loaded: this.progress.loaded,
                total: this.progress.total,
                value: this.progress.value
            });
        }
        cancel() {
            if (this.status === UploadStatus.Canceled)
                return;
            this.xhr && this.xhr.abort();
            this.status = UploadStatus.Canceled;
            this.reactive.trigger({ type: 'cancel' });
            this.defer.reject();
        }
        onChange() {
            if (this.xhr.readyState !== 4) { }
        }
        get format() {
            return FileUtil.getFormatFromName(this.name).toLowerCase();
        }
        getFormattedSize() {
            return FileUtil.formatBytes(this.size);
        }
    }
    Carbon.Upload = Upload;
    class UploadChunk {
        constructor(file, data) {
            this.status = UploadStatus.Pending;
            this.defer = new Deferred();
            if (data.size === 0) {
                throw new Error('[Upload] data.size has no data');
            }
            this.file = file;
            this.data = data;
            this.size = data.size;
            this.offset = file.offset;
            this.number = file.chunkNumber;
            this.progress = new Progress(0, this.data.size);
        }
        async send(options) {
            for (var i = 0; i < 3; i++) {
                try {
                    return await this._send(options);
                }
                catch (err) {
                    console.log('Chunk failed, retrying in 1s. ' + i + ' of 3.');
                    await delay(1000);
                }
            }
            throw new Error('error uploading chunk');
        }
        _send(options) {
            let xhr = new XMLHttpRequest();
            xhr.addEventListener('load', this.onLoad.bind(this), false);
            xhr.addEventListener('error', this.onError.bind(this), false);
            xhr.addEventListener('abort', this.onAbort.bind(this), false);
            xhr.upload.addEventListener('progress', this.onProgress.bind(this), false);
            xhr.open(options.method, options.url, true);
            let contentType = this.file.type
                ? this.file.type.replace('//', '/')
                : Carbon.Mime.fromName(this.file.name);
            if (contentType) {
                xhr.setRequestHeader('Content-Type', contentType);
            }
            else {
                xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            }
            if (options.xId) {
                xhr.setRequestHeader('x-upload-id', options.xId);
            }
            if (options.authorization) {
                if (typeof options.authorization == 'string') {
                    xhr.setRequestHeader('Authorization', options.authorization);
                }
                else {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + options.authorization.token);
                }
            }
            xhr.setRequestHeader('x-file-name', encodeURI(this.file.name));
            let range = {
                start: this.offset,
                end: Math.min(this.offset + this.file.chunkSize, this.file.size) - 1,
                total: this.file.size
            };
            xhr.setRequestHeader('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
            xhr.send(this.data);
            this.status = UploadStatus.Uploading;
            return this.defer.promise;
        }
        onProgress(e) {
            if (!e.lengthComputable)
                return;
            this.progress.loaded = e.loaded;
            if (this.onprogress)
                this.onprogress(this.progress);
        }
        onLoad(e) {
            console.log('uploaded chuck', e);
            let xhr = e.target;
            if (xhr.status == 413) {
                this.status = UploadStatus.Error;
                this.error = { code: 413, message: 'Entity too large' };
                this.defer.reject(this);
            }
            if (xhr.readyState !== 4) {
                this.onError(e);
                return;
            }
            this.result = JSON.parse(xhr.responseText);
            this.status = UploadStatus.Completed;
            if (xhr.status === 201) {
            }
            else {
            }
            this.progress.loaded = this.size;
            if (this.onprogress) {
                this.onprogress(this.progress);
            }
            this.defer.resolve(this);
        }
        onError(e) {
            this.status = UploadStatus.Error;
            this.error = e.error;
            this.defer.reject(this);
        }
        onAbort(e) {
            this.status = UploadStatus.Canceled;
            this.defer.reject(this);
        }
    }
    class DropHandler {
        constructor() {
            this.dropped = null;
            this.isActive = false;
            document.addEventListener('dragenter', this.onDragEnter.bind(this), false);
            document.addEventListener('dragover', this.onDragOver.bind(this), false);
            document.addEventListener('dragleave', this.onDragLeave.bind(this), false);
            document.addEventListener('drop', this.onDrop.bind(this), false);
            this.currentDropElement = null;
        }
        onDragEnter(e) {
            e.dataTransfer.dropEffect = 'copy';
            let target = e.target;
            let dropElement = this.getDropElement(target);
            if (dropElement) {
                for (var el of Array.from(document.querySelectorAll('.dragOver'))) {
                    el.classList.remove('dragOver');
                }
                dropElement.classList.add('dragOver');
                this.currentDropElement = dropElement;
            }
            trigger(target, 'carbon:dragenter', {
                element: dropElement || document.body,
                originalEvent: e
            });
        }
        onDragOver(e) {
            if (!this.isActive) {
                trigger(document.body, 'carbon:dragstart');
            }
            this.isActive = true;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            window.clearTimeout(this.timeoutHandle);
            this.timeoutHandle = window.setTimeout(this.onDragEnd.bind(this), 200);
            trigger(e.target, 'carbon:dragover', {
                originalEvent: e,
                clientX: e.clientX,
                clientY: e.clientY
            });
        }
        onDragLeave(e) {
            if (!this.currentDropElement)
                return;
            let box = this.currentDropElement.getBoundingClientRect();
            if ((e.y < box.top) || (e.y > box.bottom) || (e.x < box.left) || (e.x > box.right)) {
                this.currentDropElement.classList.remove('dragOver');
                this.currentDropElement = null;
            }
            trigger(e.target, 'carbon:dragleave');
        }
        onDrop(e) {
            e.preventDefault();
            this.dropped = true;
            let target = e.target;
            let files = e.dataTransfer.files;
            let items = e.dataTransfer.items;
            let dropElement = this.getDropElement(target);
            if (dropElement) {
                dropElement.classList.remove('dragOver');
            }
            if (files.length === 0)
                return;
            let detail = {
                files: files,
                items: items,
                element: dropElement || document.body
            };
            this.dropped = detail;
            trigger(detail.element, 'carbon:drop', detail);
        }
        onDragEnd() {
            trigger(document.body, 'carbon:dragend', {
                dropped: this.dropped
            });
            this.isActive = false;
            this.dropped = null;
        }
        getDropElement(target) {
            let droppableEl = target.closest('.droppable');
            if (droppableEl) {
                return droppableEl;
            }
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
        }
    }
    DropHandler.instance = new DropHandler();
    Carbon.DropHandler = DropHandler;
    class FileDrop {
        constructor(element, options = {}) {
            this.reactive = new Carbon.Reactive();
            if (typeof element === 'string') {
                this.element = document.querySelector(element);
            }
            else {
                this.element = element;
            }
            if (!this.element)
                throw new Error('[FileDrop] element not found');
            this.options = options;
            if (this.element.classList.contains('setup'))
                return;
            this.element.classList.add('setup');
            if (!this.element.getAttribute('on-drop')) {
                this.element.setAttribute('on-drop', 'pass');
                this.element.classList.add('droppable');
            }
            this.element.addEventListener('carbon:drop', (e) => {
                this.reactive.trigger(e.detail.files);
            });
        }
        subscribe(callback) {
            return this.reactive.subscribe(callback);
        }
        clear() { }
        setAccept(formats) {
            this.options.accept = formats;
        }
    }
    Carbon.FileDrop = FileDrop;
    class FileInput {
        constructor(element, options) {
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
        subscribe(callback) {
            return this.reactive.subscribe(callback);
        }
        clear() {
            this.element.value = '';
        }
        setAccept(formats) {
            this.element.setAttribute('accept', formats.map(f => '.' + f).join(','));
        }
        onChange(e) {
            let files = this.element.files;
            if (files.length === 0)
                return;
            this.reactive.trigger(files);
        }
    }
    Carbon.FileInput = FileInput;
    let FileUtil = {
        scales: ['B', 'KB', 'MB', 'GB'],
        getFormatFromName(name) {
            let split = name.split('.');
            return split[split.length - 1];
        },
        threeNonZeroDigits(value) {
            if (value >= 100)
                return Math.floor(value);
            return (value >= 10)
                ? Math.round(value * 10) / 10
                : Math.round(value * 100) / 100;
        },
        formatBytes(byteCount) {
            let i = 0;
            let base = 1000;
            let value = byteCount;
            while ((base - 1) < value) {
                value /= base;
                i++;
            }
            return FileUtil.threeNonZeroDigits(value) + " " + FileUtil.scales[i];
        }
    };
    let formatMap = {
        aac: 'audio',
        aiff: 'audio',
        flac: 'audio',
        m4a: 'audio',
        mp3: 'audio',
        oga: 'audio',
        opus: 'audio',
        wav: 'audio',
        wma: 'audio',
        avif: 'image',
        avifs: 'image',
        bmp: 'image',
        cr2: 'image',
        jpg: 'image',
        jpeg: 'image',
        jxl: 'image',
        gif: 'image',
        ico: 'image',
        heic: 'image',
        heif: 'image',
        png: 'image',
        psd: 'image',
        svg: 'image',
        tif: 'image',
        tiff: 'image',
        webp: 'image',
        usdz: 'model',
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
        eof: 'font',
        woff: 'font',
        woff2: 'font',
        ai: 'application',
        pdf: 'application',
        wasm: 'application'
    };
    let mimeMap = {
        jxl: 'image/jxl',
        usdz: 'model/vnd.usd+zip',
        woff: 'font/woff',
        woff2: 'font/woff2'
    };
    Carbon.Mime = {
        register(format, type) {
            mimeMap[format] = type;
        },
        fromName(name) {
            let format = FileUtil.getFormatFromName(name);
            return Carbon.Mime.fromFormat(format);
        },
        fromFormat(format) {
            if (mimeMap[format]) {
                return mimeMap[format];
            }
            let type = formatMap[format];
            if (type === undefined)
                return null;
            return type + '/' + format;
        },
        async detect(blob) {
            let buffer = await blob.slice(0, 4).arrayBuffer();
            let hex = toHexString(new Uint8Array(buffer));
            switch (hex) {
                case '89504e47':
                    return 'image/png';
                case '47494638':
                    return 'image/gif';
                case '25504446':
                    return 'application/pdf';
                case 'ffd8ffdb':
                case 'ffd8ffe0':
                case 'ffd8ffe1':
                    return 'image/jpeg';
                default:
                    return null;
            }
        }
    };
    function toHexString(bytes) {
        return Array.from(bytes)
            .map(i => i.toString(16).padStart(2, '0'))
            .join('');
    }
    ;
    class UrlUpload {
        constructor(url, options) {
            this.progress = new Progress(0, 100);
            this.defer = new Deferred();
            this.reactive = new Carbon.Reactive();
            this.url = url;
            this.status = 0;
            this.promise = this.defer.promise;
            if (options.name) {
                this.name = options.name;
                this.format = this.name.substring(this.name.lastIndexOf('.') + 1);
            }
            else {
                this.format = this.url.substring(this.url.lastIndexOf('.') + 1);
            }
            this.authorization = options.authorization;
            if (options.size) {
                this.size = options.size;
            }
            this.type = Carbon.Mime.fromFormat(this.format);
        }
        onProgress(e) {
            this.progress.loaded = e.loaded;
            this.reactive.trigger({
                type: 'progress',
                loaded: this.progress.loaded,
                total: this.progress.total,
                value: this.progress.value
            });
            if (e.loaded < 100) {
                setTimeout(() => {
                    this.onProgress({ loaded: e.loaded + 1 });
                }, 10);
            }
        }
        on(name, callback) {
            this.reactive.on(name, callback);
        }
        async start() {
            let headers = {
                'Accept': 'application/json',
                'Authorization': 'Bearer ' + this.authorization.token,
                'x-copy-source': this.url
            };
            if (this.name) {
                headers['x-file-name'] = this.name;
            }
            let response = await fetch(this.authorization.url, {
                mode: 'cors',
                method: 'PUT',
                headers: headers
            });
            let result = await response.json();
            this.onDone(result);
            this.onProgress({ loaded: this.progress.loaded });
            this.reactive.trigger({ type: 'start' });
            return this.defer.promise;
        }
        onDone(data) {
            this.status = UploadStatus.Completed;
            this.result = data;
            this.defer.resolve(data);
        }
    }
    Carbon.UrlUpload = UrlUpload;
})(Carbon || (Carbon = {}));
class Deferred {
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }
    resolve(value) {
        this._resolve(value);
    }
    reject(value) {
        this._reject(value);
    }
}
function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}
function trigger(element, name, detail) {
    return element.dispatchEvent(new CustomEvent(name, {
        bubbles: true,
        detail: detail
    }));
}
