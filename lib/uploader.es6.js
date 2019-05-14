export class Progress {
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
export class UploadBatch {
    constructor() {
        this.queued = [];
        this.rejected = [];
    }
}
export class UploadManager {
    constructor(options) {
        this.status = UploadStatus.Pending;
        this.subscriptions = [];
        this.completedCount = 0;
        this.canceledCount = 0;
        this.debug = false;
        this.maxSize = 5000000000;
        this.reactive = new Reactive();
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
        return this.options.accept.filter(f => f == format).length > 0;
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
        if (!files || files.length == 0)
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
        if (this.debug) {
            console.log('Upload limit set: ' + value);
        }
    }
    start() {
        this.status = UploadStatus.Uploading;
        this.reactive.trigger({
            type: 'start',
            instance: this
        });
        this.uploadNext();
    }
    uploadNext() {
        if (this.queue.length == 0) {
            this.status = UploadStatus.Completed;
            this.reactive.trigger({
                type: 'complete',
                instance: this,
                uploads: this.uploads
            });
            return;
        }
        let upload = this.queue.shift();
        upload.on('progress', e => {
            var loaded = 0;
            var total = 0;
            for (var upload of this.uploads) {
                loaded += upload.progress.loaded;
                total += upload.size;
            }
            this.progress.loaded = loaded;
            this.progress.total = total;
            this.notify();
        });
        this.reactive.trigger({
            type: 'upload:start',
            upload: upload
        });
        upload.start().then(() => {
            this.completedCount++;
            this.reactive.trigger({
                type: 'upload:complete',
                upload: upload
            });
            this.notify();
            this.uploadNext();
        }, () => {
            this.canceledCount++;
            this.reactive.trigger({
                type: 'upload:error',
                upload: upload
            });
            this.notify();
            this.uploadNext();
        });
    }
    notify() {
        this.reactive.trigger({
            type: 'progress',
            loaded: this.progress.loaded,
            total: this.progress.total,
            value: this.progress.value
        });
    }
    cancel() {
        this.uploads.forEach(u => { u.cancel(); });
        this.status = UploadStatus.Canceled;
        this.reactive.trigger({ type: 'cancel' });
    }
    dispose() {
        this.cancel();
    }
}
var UploadStatus;
(function (UploadStatus) {
    UploadStatus[UploadStatus["Pending"] = 1] = "Pending";
    UploadStatus[UploadStatus["Uploading"] = 2] = "Uploading";
    UploadStatus[UploadStatus["Completed"] = 3] = "Completed";
    UploadStatus[UploadStatus["Canceled"] = 4] = "Canceled";
    UploadStatus[UploadStatus["Error"] = 5] = "Error";
})(UploadStatus || (UploadStatus = {}));
export class Upload {
    constructor(file, options) {
        this.status = UploadStatus.Pending;
        this.retryCount = 0;
        this.debug = false;
        this.chunkSize = 1024 * 1024 * 32;
        this.rejected = false;
        this.reactive = new Reactive();
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
    start() {
        if (this.status >= 2) {
            return Promise.reject('[Upload] already started');
        }
        this.offset = 0;
        this.chunkNumber = 1;
        this.chunkCount = Math.ceil(this.size / this.chunkSize);
        this.next();
        this.status = UploadStatus.Uploading;
        this.reactive.trigger({ type: 'start' });
        return this.defer.promise;
    }
    next() {
        if (this.offset + 1 >= this.size)
            return;
        if (this.chunkCount > 1) {
            console.log(`'${this.name}' uploading ${this.chunkNumber} of ${this.chunkCount} chunks.`);
        }
        let start = this.offset;
        let end = this.offset + this.chunkSize;
        let data = this.file.slice(start, end);
        let chunk = new UploadChunk(this, data);
        chunk.onprogress = this.onProgress.bind(this);
        chunk.send(this).then(this.onChunkUploaded.bind(this), this.onChunkFailed.bind(this));
    }
    onChunkFailed(chunk) {
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
    }
    onChunkUploaded(chunk) {
        this.chunkNumber++;
        this.offset += chunk.size;
        this.result = chunk.result;
        this.id = this.result.id;
        this.retryCount = 0;
        if (this.offset == this.size) {
            this.reactive.trigger({ type: 'complete' });
            this.defer.resolve(this.result);
        }
        else {
            this.xId = this.result.id;
            this.next();
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
    onError(e) {
        console.log('upload error', e);
        this.status = UploadStatus.Error;
        this.reactive.trigger({ type: 'error' });
        this.defer.reject();
    }
    cancel() {
        if (this.status == UploadStatus.Canceled)
            return;
        if (this.xhr && this.status != 4) {
            this.xhr.abort();
        }
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
class UploadChunk {
    constructor(file, data) {
        this.status = UploadStatus.Pending;
        this.defer = new Deferred();
        if (data.size == 0)
            throw new Error('[Upload] data.size has no data');
        this.file = file;
        this.data = data;
        this.size = data.size;
        this.offset = file.offset;
        this.number = file.chunkNumber;
        this.progress = new Progress(0, this.data.size);
    }
    send(options) {
        let xhr = new XMLHttpRequest();
        xhr.addEventListener('load', this.onLoad.bind(this), false);
        xhr.addEventListener('error', this.onError.bind(this), false);
        xhr.addEventListener('abort', this.onAbort.bind(this), false);
        xhr.upload.addEventListener('progress', this.onProgress.bind(this), false);
        xhr.open(options.method, options.url, true);
        let contentType = this.file.type
            ? this.file.type.replace('//', '/')
            : mimes[this.file.name.substring(this.file.name.lastIndexOf('.') + 1)];
        if (contentType) {
            xhr.setRequestHeader('Content-Type', contentType);
        }
        if (options.xId) {
            xhr.setRequestHeader('X-Upload-Id', options.xId);
        }
        if (options.authorization) {
            if (typeof options.authorization == 'string') {
                xhr.setRequestHeader('Authorization', options.authorization);
            }
            else {
                xhr.setRequestHeader('Authorization', 'Bearer ' + options.authorization.token);
            }
        }
        xhr.setRequestHeader('X-File-Name', encodeURI(this.file.name));
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
        if (xhr.status == 201) {
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
export class FileInput {
    constructor(element, options) {
        this.reactive = new Reactive();
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
        if (navigator.userAgent && navigator.userAgent.indexOf('MSIE') === -1) {
            this.element.value = '';
        }
    }
    setAccept(formats) {
        this.element.setAttribute('accept', formats.map(f => '.' + f).join(','));
    }
    onChange(e) {
        let files = this.element.files;
        if (files.length == 0)
            return;
        this.reactive.trigger(files);
    }
}
let FileUtil = {
    scales: ['B', 'KB', 'MB', 'GB'],
    getFormatFromName(name) {
        let split = name.split('.');
        return split[split.length - 1];
    },
    threeNonZeroDigits(value) {
        if (value >= 100)
            return Math.floor(value);
        if (value >= 10) {
            return Math.round(value * 10) / 10;
        }
        else {
            return Math.round(value * 100) / 100;
        }
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
let fileFormats = {
    aac: 'audio',
    aiff: 'audio',
    flac: 'audio',
    m4a: 'audio',
    mp3: 'audio',
    oga: 'audio',
    opus: 'audio',
    wav: 'audio',
    wma: 'audio',
    bmp: 'image',
    cr2: 'image',
    jpg: 'image',
    jpeg: 'image',
    gif: 'image',
    ico: 'image',
    png: 'image',
    psd: 'image',
    svg: 'image',
    tif: 'image',
    tiff: 'image',
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
    pdf: 'application'
};
let mimes = {
    usdz: 'model/vnd.usd+zip',
    woff: 'font/woff',
    woff2: 'font/woff2'
};
;
export class Reactive {
    constructor(key) {
        this.listeners = [];
        this.key = key;
    }
    on(name, callback) {
        return this.subscribe(callback, e => e.type == name);
    }
    off(name) {
        for (var listener of Array.from(this.listeners)) {
            if (listener.filter && listener.filter({ type: name })) {
                listener.dispose();
            }
        }
    }
    once(name, callback) {
        return this.subscribe(callback, {
            filter: e => e.type == name,
            once: true
        });
    }
    subscribe(callback, options) {
        let listener = new Listener(callback, this, options);
        this.listeners.push(listener);
        return listener;
    }
    unsubscribe(listener) {
        let index = this.listeners.indexOf(listener);
        if (index > -1) {
            this.listeners.splice(index, 1);
            if (this.listeners.length == 0) {
                this.dispose();
            }
        }
    }
    trigger(e, data) {
        if (typeof e == "string") {
            var d = { type: e };
            if (data) {
                Object.assign(d, data);
                data = null;
            }
            e = d;
        }
        for (var listener of Array.from(this.listeners)) {
            listener.fire(e, data);
        }
    }
    dispose() {
        while (this.listeners.length > 0) {
            this.listeners.pop();
        }
    }
}
export class Listener {
    constructor(callback, reactive, optionsOrFilter) {
        this.fireCount = 0;
        this.active = true;
        this.reactive = reactive;
        this.callback = callback;
        if (typeof optionsOrFilter === 'function') {
            this.filter = optionsOrFilter;
        }
        else if (optionsOrFilter) {
            let options = optionsOrFilter;
            this.scope = options.scope;
            this.filter = options.filter;
            this.once = options.once;
        }
    }
    fire(e, data) {
        if (!this.active)
            return;
        if (this.filter && !this.filter(e))
            return;
        this.callback(e, data || this);
        this.lastFired = new Date();
        this.fireCount++;
        if (this.once) {
            this.dispose();
        }
    }
    pause() {
        this.active = false;
    }
    resume() {
        this.active = true;
    }
    dispose() {
        this.active = false;
        this.reactive.unsubscribe(this);
    }
}
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
if (Array.prototype.remove === undefined) {
    Array.prototype.remove = function (item) {
        var index = this.indexOf(item);
        if (index != -1) {
            this.splice(index, 1);
        }
    };
}
