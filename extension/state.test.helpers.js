/**
 * [INPUT]: 実 extension・dashboard ソース、node:vm とイベント API に依存する。
 * [OUTPUT]: メッセージ経由で対戦状態を操作し、言語別 DB・OS 子プロセス・時計を制御する隔離テスト環境を提供する。
 * [POS]: 状態回帰の共通境界。OS・通信・時計・Replicant のみを置換し、業務モジュールは実コードを実行する。
 * [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const cards = Object.fromEntries([1, 2, 3].map(prize => [`card${prize}`, {
    name: `Fixture ${prize}`, card_type: 'Pokemon', pokemon: { hp: 200, prize, color: ['無'] }
}]));

async function createHarness(saved = {}, options = {}) {
    const reps = new Map(), handlers = new Map(), messages = [], logs = [];
    const timers = new Map();
    let time = 1700000000000, timerId = 0;
    class Clock extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
    const tick = () => new Promise(setImmediate);
    function makeRep(name, initial) {
        const events = new EventEmitter();
        let current, scheduled = false, old;
        function notify(previous) {
            if (scheduled) return;
            scheduled = true; old = previous;
            queueMicrotask(() => { scheduled = false; events.emit('change', current, old); });
        }
        function wrap(value) {
            if (!value || typeof value !== 'object') return value;
            for (const key of Object.keys(value)) value[key] = wrap(value[key]);
            return new Proxy(value, {
                set(target, key, next) {
                    if (target[key] === next) return true;
                    const previous = clone(current);
                    target[key] = wrap(clone(next)); notify(previous); return true;
                },
                deleteProperty(target, key) { const previous = clone(current); delete target[key]; notify(previous); return true; }
            });
        }
        const rep = { name, on: events.on.bind(events), once: events.once.bind(events) };
        Object.defineProperty(rep, 'value', {
            get: () => current,
            set(value) { const previous = clone(current); current = wrap(clone(value)); notify(previous); }
        });
        rep.value = initial;
        return rep;
    }
    const pending = new Set();
    const nodecg = {
        Replicant(name, options = {}) {
            if (!reps.has(name)) reps.set(name, makeRep(name, Object.hasOwn(saved, name) ? saved[name] : options.defaultValue));
            return reps.get(name);
        },
        listenFor(name, listener) { handlers.set(name, listener); },
        sendMessage(name, data) {
            messages.push({ name, data: clone(data) });
            const job = Promise.resolve().then(() => dispatch(name, data));
            pending.add(job); job.then(() => pending.delete(job), () => pending.delete(job));
            return job;
        },
        log: Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, (...args) => logs.push({ level, args })]))
    };
    async function dispatch(name, data) {
        const handler = handlers.get(name);
        if (!handler) return;
        let error, answer;
        await handler(clone(data), (err, value) => { error = err; answer = value; });
        if (error) throw error;
        return answer;
    }
    async function flush() {
        for (let i = 0; i < 5 || pending.size; i++) {
            if (i > 100) throw Error('Messages did not settle');
            await Promise.all([...pending]); await tick();
        }
    }
    const databases = { jp: cards, ...options.databases };
    const databaseLanguage = file => /database_([^/\\]+)\.json$/.exec(String(file))?.[1];
    const fakeFs = {
        existsSync(file) {
            const lang = databaseLanguage(file);
            return lang ? Object.hasOwn(databases, lang) && databases[lang] !== undefined : /strings\.json$/.test(String(file));
        },
        mkdirSync() {},
        readFileSync(file) {
            const lang = databaseLanguage(file);
            if (lang && Object.hasOwn(databases, lang) && databases[lang] !== undefined) {
                const value = databases[lang];
                return typeof value === 'string' ? value : JSON.stringify(value);
            }
            if (/strings\.json$/.test(String(file))) return fs.readFileSync(file, 'utf8');
            throw Error(`Unexpected filesystem read: ${file}`);
        },
        readdirSync: () => []
    };
    const fakeHttps = { get() { const request = new EventEmitter(); request.setTimeout = () => request; request.destroy = () => {}; return request; } };
    const context = vm.createContext({
        process, Buffer, URL, URLSearchParams, console, Date: Clock,
        setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: time + ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        setInterval(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: time + ms, interval: ms }); return id; },
        clearInterval(id) { timers.delete(id); }
    });
    const modules = new Map();
    function load(file) {
        if (modules.has(file)) return modules.get(file).exports;
        const module = { exports: {} }; modules.set(file, module);
        if (file.endsWith('.json')) { module.exports = JSON.parse(fs.readFileSync(file, 'utf8')); return module.exports; }
        const localRequire = name => {
            const builtin = name.replace(/^node:/, '');
            if (builtin === 'fs') return fakeFs;
            if (builtin === 'https') return fakeHttps;
            if (builtin === 'child_process') return { spawn: options.spawn || (() => { throw Error('Subprocesses are outside this state test'); }) };
            if (!name.startsWith('.')) return require(name);
            const resolved = require.resolve(path.resolve(path.dirname(file), name));
            return load(resolved);
        };
        vm.runInContext(`(function(require,module,exports,__dirname,__filename){\n${fs.readFileSync(file, 'utf8')}\n})`, context, { filename: file })(localRequire, module, module.exports, path.dirname(file), file);
        return module.exports;
    }
    load(path.join(__dirname, 'index.js'))(nodecg);
    await flush();
    const frontend = vm.createContext({
        nodecg, operationQueue: nodecg.Replicant('operationQueue'), window: {},
        console: { error: (...args) => logs.push({ level: 'ui-error', args }) }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../dashboard/js/dashboard.js'), 'utf8'), frontend);
    const api = {
        get: name => clone(nodecg.Replicant(name).value),
        set: (name, value) => { nodecg.Replicant(name).value = value; },
        snapshot: () => Object.fromEntries([...reps].map(([name, rep]) => [name, clone(rep.value)])),
        messages, logs, flush,
        setDatabase(language, value) { databases[language] = clone(value); },
        beginRequest(name, data) {
            time += 1100;
            const result = new Promise((resolve, reject) => {
                try {
                    const handler = handlers.get(name);
                    if (!handler) throw new Error(`Unknown message: ${name}`);
                    Promise.resolve(handler(clone(data), (error, answer) => error ? reject(error) : resolve(answer))).catch(reject);
                } catch (error) { reject(error); }
            });
            result.catch(() => {});
            return { result };
        },
        async request(name, data) {
            time += 1100;
            if (name === 'animationBatchComplete' && data === undefined) {
                const batch = messages.findLast(message => message.name === 'animationBatchStart')?.data;
                if (batch) {
                    for (const graphic of batch.graphics) {
                        await dispatch(name, { batchId: batch.batchId, graphic });
                        await flush();
                    }
                    return;
                }
            }
            const result = await dispatch(name, data);
            await flush();
            return result;
        },
        async ui(type, payload, merge = false) {
            time += 1100;
            frontend[merge ? 'queueOrUpdateOperation' : 'queueOperation'](type, clone(payload)); await flush();
        },
        async apply(record = false) {
            await api.request(record ? 'applyOpsPack' : 'applyQueue');
            for (let i = 0; api.get('processorStatus') === 'PROCESSING'; i++) {
                if (i > 100) throw Error('Processor did not finish');
                const batch = messages.findLast(message => message.name === 'animationBatchStart')?.data;
                if (batch && batch.graphics.length === 0) await api.advance(10000);
                else await api.request('animationBatchComplete');
            }
        },
        async place(target, cardId = 'card1') { await api.ui('SET_POKEMON', { target, cardId }); await api.apply(); },
        async advance(ms) {
            time += ms;
            for (const [id, timer] of [...timers]) {
                if (timer.at > time) continue;
                if (timer.interval) timer.at = time + timer.interval; else timers.delete(id);
                await timer.fn();
            }
            await flush();
        }
    };
    return api;
}
module.exports = { createHarness, clone, cards };
