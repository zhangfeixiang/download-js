#!/usr/bin/env node

/*
作者：小鱼儿
github：https://github.com/zhangfeixiang

*/

const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");
const progressBar = require('@jyeontu/progress-bar');

const config = {
    duration: 100,
    current: 0,
    block: '█',
    showNumber: true,
    tip: {
        0: '努力下载中……',
        50: '下载一半啦，不要着急……',
        75: '马上就下载完了……',
        100: '下载完成'
    },
    color: 'blue'
}
let progressBarA = new progressBar(config);
const errlist = [];
let basePath = __dirname;

// 下载队列
class Queue {
    constructor(max = 2) {
        this._list = [];
        this.max = max;
    }

    async push(promise) {
        promise.finally(() => {
            const index = this._list.indexOf(promise);
            this._list.splice(index, 1);
        });

        this._list.push(promise);
        if (this._list.length >= this.max) await Promise.race([...this._list]);
        return Promise.resolve();
    }
    async finish() {
        return await Promise.all(this._list), Promise.resolve();
    }
}


/**
 * 根据url结构创建文件夹
 * @param basePath rquired 输出文件夹根目录
 * @param pathStr 图片网址
 * @return path 返回绝对路径
 */
function createFolders(pathStr, {
    basePath,
    needEmpty
} = {
    needEmpty: false
}) {
    if (!pathStr) {
        console.error('pathStr cannot be empty')
        return
    };

    // http://xxx.xxx.com/xxx/xxx/xxx/filename.png
    let dirs = pathStr.split('/').slice(3, -1)
    let currentPath = basePath || __dirname;
    dirs
        .forEach(dir => {
            // 如果路径包含 xx//x.png 空目录转为null
            if (dir === '') dir = 'null';
            currentPath = path.join(currentPath, dir)
            // 当前目录不存在
            if (!fs.existsSync(currentPath)) {
                fs.mkdirSync(currentPath);
                return;
            }
            var tempstats = fs.statSync(currentPath);
            // 文件目录不为空且需要清空
            if (!(tempstats.isDirectory()) && needEmpty) {
                fs.unlinkSync(currentPath);
                fs.mkdirSync(currentPath);
            }
        })
    return currentPath;
}


/**
 * 下载文件
 * @param {*} param0 { url: string; path: string }
 * @param {*} cb {progress: int; type: 'upload' | 'compress' | 'download' }
 */
function _download({
    url,
    path
}, cb = (op) => {}) {
    // 根据协议 
    const [protocol] = url.split('://')
    const request = {
        http,
        https
    }
    return new Promise((resolove, reject) => {
        cb({
            filePath: path,
            progress: 0,
            type: 'download'
        });
        const req = request[protocol].get(url, res => {
            const size = Number(res.headers['content-length']);
            let buffs = 0;
            // 删除文件，防止被追加进去
            if (fs.existsSync(path)) {
                fs.unlinkSync(path);
            }
            let downloadfile = fs.createWriteStream(path, {
                'flags': 'a'
            });
            res.setEncoding('binary');
            res.on('data', buf => {
                buffs += buf.length;
                downloadfile.write(buf, 'binary');
                cb({
                    filePath: path,
                    progress: buffs / size,
                    type: 'download'
                });
            });
            res.on('end', () => {
                const {
                    statusCode = 0
                } = res;
                if (statusCode >= 200 && statusCode < 400) {
                    if (path.indexOf('?') > -1) {
                        path = path.substr(0, path.indexOf('?'))
                    }
                    // console.log('成功下载至：', path)
                    downloadfile.end();
                    resolove()
                    // fs.writeFile(path, buffs, 'binary', err => (err ? reject(err) : resolove()));
                } else {
                    downloadfile.end();
                    if (fs.existsSync(path)) {
                        fs.unlinkSync(path);
                    }
                    reject(new Error(buffs));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}


/**
 * 下载进度
 * @param {*} param0 
 * @returns 
 */
function calcProgress({
    type,
    progress,
    filePath
}) {
    const status = progress < 1 ? ['下载中'] : ['下载完成'];
    const result = {
        progress,
        status,
        filePath
    };
    return result;
}

/**
 * downloader下载
 * @param {*} param0 
 * @param {*} cb 
 * @returns 
 */
async function downloader({
    url,
    basePath = __dirname,
    path: _path
}, cb = (op) => {}) {
    return new Promise(async (reslove, reject) => {
        const data = await _download({
            url: url,
            path: path.join(basePath, _path)
        }, p => {
            cb(calcProgress(p))
        }).catch((error) => {
            cb({
                progress: 0,
                status: ['下载失败'],
            })
            return error
        });
        if (data instanceof Error) return reject({
            type: 'download',
            error: data,
            url: url
        });
        reslove(data);
    });
}

/**
 * 根据url取最后一节名称
 * @param {string} url 
 * @returns 
 */
function getFilename(url) {
    if (!url) return '';
    let filename = url.split('/').slice(-1)[0] || 'null'
    // 过滤带参数文件url
    if (filename.indexOf('?') > -1) {
        filename = filename.substring(0, filename.indexOf('?'))
    }
    return filename
}

// 节流
function throttle(func, delay) {
    var timer = null;
    var startTime = Date.now();
    return function (...agrs) {
        var curTime = Date.now();
        var remaining = delay - (curTime - startTime);
        var context = this;
        var args = arguments;
        clearTimeout(timer);
        if (remaining <= 0) {
            func.apply(context, args);
            startTime = Date.now();
        } else {
            timer = setTimeout(() => func(...agrs), remaining);
        }
    }
}

async function isGif(file) {
    const ret = await blobToString(file.slice(0, 6))
    const isgif = (ret === '47 49 46 38 39 61') || (ret === '47 49 46 38 37 61')
    return isgif
}

async function isPng(file) {
    const ret = await blobToString(file.slice(0, 8))
    const ispng = ret === '89 50 4E 47 0D 0A 1A 0A'
    return ispng
}

async function isJpg(file) {
    // jpg开头两个是 FF D8
    // 结尾两个是 FF D9
    const len = file.size
    const start = await blobToString(file.slice(0, 2))
    const tail = await blobToString(file.slice(-2, len))
    const isjpg = start === 'FF D8' && tail === 'FF D9'
    return isjpg
}

function getImageType(file) {
    if (isPng(file)) {
        return '.png'
    }
    if (isJpg(file)) {
        return '.jpg'
    }
    if (isGif(file)) {
        return '.gif'
    }
    return null

}

// 二进制=> ascii码=> 转成16进制字符串
async function blobToString(blob) {
    return new Promise(resolve => {
        const reader = new FileReader()
        reader.onload = function () {
            const ret = reader.result.split('')
                .map(v => v.charCodeAt())
                .map(v => v.toString(16).toUpperCase())
                .map(v => v.padStart(2, '0'))
                .join(' ')
            resolve(ret)
        }
        reader.readAsBinaryString(blob)
    })
}

// 开始下载
async function startDownloadList(list) {
    const queue = new Queue(1);
    for (const [index, linkUrl] of Object.entries(list)) {
        await queue.push(downloadOne(linkUrl, Number(index), list));
    }
    await queue.finish();
    return Promise.resolve({
        error: errlist
    });
}

// 进度节流
const progressCallback = throttle(updateProgress, 100);

// 下载进度回调
function updateProgress(data, index, list) {};

async function downloadOne(taskItem, index, list) {

    // 根据网址生成文件夹
    createFolders(taskItem, {
        basePath
    });
    // 不含域名的部分
    const temp = taskItem.split("/").slice(3).join("/");
    const res = await downloader({
        basePath,
        url: taskItem,
        path: temp
    }, data => progressCallback(data, index, list)).then(() => {
        // process.stdout.write(`${index + 1} / ${list.length} \n`);
        progressBarA.run(((index + 1) / list.length) * 100);
    }).catch((error) => {
        errlist.push(error.url);
        return null;
    });

    if (!res) return;
}


async function showMenu() {
    const inquirer = require('inquirer');
    const argv = require('minimist')(process.argv.slice(2));
    let q1 = '确定下载到当前目录吗';
    if (argv['o'] || argv['output']) {
        basePath = argv['o'] || argv['output'];
    } else {
        const res = await inquirer.prompt([{
            name: q1,
            type: "list",
            choices: ['可以', '不要'],
            required: true,
        }])
        var isOk = res[q1] === '可以';
        if (!isOk) {
            console.log('客官先进入要保存的目录再来吧~')
            return;
        }
    }
    const result = await startDownloadList(argv._);
    console.log('这些下载失败了，检查一下吧 ~=>', result);
}


if (require.main === module) {
    showMenu();
}