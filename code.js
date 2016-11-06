/* global URL, fetch */
const Treeherder = 'https://treeherder.mozilla.org/api/project/';
const tree = 'try';

let signatures, resultsets, Results = {}, revisions, res_ids_2_rev = {};

function onLoad() {
    revisions = new URL(document.location).searchParams.getAll('revision');
    let loading = [];
    let signatures_url = new URL(Treeherder + tree + '/performance/signatures/');
    signatures_url.searchParams.set('framework', 1);
    signatures_url.searchParams.set('subtests', 0);
    signatures_url.searchParams.set('interval', 604800);
    loading.push(fetch(signatures_url)
        .then(response => response.json()));
    revisions.forEach(function(revision) {
        let result_set_url = new URL(Treeherder + tree + '/resultset/');
        result_set_url.searchParams.set('revision', revision);
        loading.push(fetch(result_set_url)
            .then(response => response.json()));
    });
    Promise.all(loading).then(loadResults);
}

function loadResults(responses) {
    [signatures, ...resultsets] = responses;
    let resultset_ids = [];
    resultsets.forEach(function(rs) {
        rs.results.forEach(function (r) {
            resultset_ids.push(r.id);
            res_ids_2_rev[r.id] = rs.meta.revision;
        });
    });
    console.log(resultset_ids);
    let sigs = Object.keys(signatures);
    let loading = [];
    while (sigs.length) {
        let chunk = sigs.splice(0, 10);
        let results_url = new URL(Treeherder + tree + '/performance/data/');
        chunk.forEach(function(id) {
            results_url.searchParams.append('signatures', id);
        });
        resultset_ids.forEach(function(id) {
            results_url.searchParams.append('result_set_id', id);
        });
        results_url.searchParams.set('framework', 1);
        loading.push(fetch(results_url)
            .then(response => response.json())
            .then(function(talos_numbers) {
                Object.keys(talos_numbers).forEach(function(prop) {
                    Results[prop] = talos_numbers[prop];
                });
            }));
    }
    Promise.all(loading).then(renderResults);
    console.log('I think i am done');
}

function renderResults() {
    let body = document.querySelector("#container");
    body.innerHTML = '';
    let found_sigs = Object.keys(Results);
    let rows = new Map();
    let val_span = 0;
    found_sigs.forEach(function(sig) {
        let test = signatures[sig];
        let name = test.test||test.suite;
        if (test.test_options) {
            name += ' (' + test.test_options[0] + ')';
        }
        if (!rows.has(name)) {
            rows.set(name, new Map());
        }
        let row = rows.get(name);
        row.set(test.machine_platform, sig);
        let test_results = Results[sig];
        let values = test_results.map(test => test.value);
        let min = Math.min.apply(null, values);
        let max = Math.max.apply(null, values);
        val_span = Math.max(max - min, val_span);
        let revs = new Set();
        let results = test_results.map(function(result) {
            let rev = res_ids_2_rev[result.result_set_id];
            revs.add(rev);
            return {
                revision: rev,
                value: result.value,
            };
        });
        revs = revisions.filter(rev => revs.has(rev));
        row.set(test.machine_platform, {
            max: max,
            min: min,
            tested_revisions: revs,
            results: results,
        });
    });
    val_span = Math.ceil(val_span);
    rows = Array.from(rows);
    rows.sort();
    rows.forEach(function(t) {
        let [label, platform_map] = t;
        let platforms = Array.from(platform_map);
        platforms.sort();
        platforms.forEach(function (t, i) {
            let [platform, {max, min, tested_revisions, results}] = t;
            let lower_bound = Math.max(Math.floor((max + min - val_span) / 2), 0);
            let domain = [lower_bound , lower_bound + val_span];
            let row = document.createElement('tr');
            if (i === 0) {
                row.innerHTML = `<td rowspan="${platforms.length}">${label}</td>`;
            }
            row.insertAdjacentHTML('beforeend', `<td>${platform}</td>`);
            row.insertAdjacentHTML('beforeend', `<td>${domain[0]}</td>`);
            var data_cell = document.createElement('td');
            results.forEach(function(result) {
                data_cell.insertAdjacentHTML('beforeend',
                    `<span style="color: #${result.revision.slice(6)};">${result.value}</span> `);
            });
            row.appendChild(data_cell);
            row.insertAdjacentHTML('beforeend', `<td>${domain[1]}</td>`);
            body.appendChild(row);
        });
    });
}

onLoad();
