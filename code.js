/* global URL, fetch, d3 */
const Treeherder = 'https://treeherder.mozilla.org/api/project/';
const HG='https://hg.mozilla.org/'
const tree = 'try';

let signatures, resultsets, Results = {}, revisions, res_ids_2_rev = {};

function onLoad() {
    revisions = new URL(document.location).searchParams.getAll('revision');
    showRevisions();
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
    Promise.all(loading).then(collectPlatforms);
}

function collectPlatforms() {
    let found_sigs = Object.keys(Results);
    let platforms = new Set(found_sigs.map(function(sig) {
        return signatures[sig].machine_platform;
    }));
    platforms = Array.from(platforms);
    let container = document.getElementById('platforms');
    container.innerHTML = '';
    platforms.forEach(function(platform) {
        let row = document.createElement('tr');
        row.innerHTML = `<td><input data-platform="${platform}" type="checkbox" checked></tr>`;
        row.insertAdjacentHTML('beforeend', `<td>${platform}</td>`);
        row.querySelector('input').onchange = renderResults;
        container.appendChild(row);
    });
    renderResults();
}

function renderResults() {
    let body = document.querySelector("#container");
    body.innerHTML = '';
    let found_sigs = Object.keys(Results);
    let rows = new Map();
    let val_span = 0;
    let platformFilter = new Set(
        Array.from(document.querySelectorAll('#platforms input:checked'))
        .map(function(checked) {
            return checked.dataset.platform;
        }));
    found_sigs.forEach(function(sig) {
        let test = signatures[sig];
        if (!platformFilter.has(test.machine_platform)) {
            // only show selected platforms
            return;
        }
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
            row.insertAdjacentHTML('beforeend', '<td class="graph"><svg></svg></td>');
            let y_scale = d3.scaleOrdinal(
                revisions.map((rev, i) => i*10 + 5));
            y_scale.domain(tested_revisions);
            let x_scale = d3.scaleLinear();
            x_scale.range([5, 795]);
            x_scale.domain(domain);
            d3.select(row).select('svg')
                .attr('width', 800)
                .attr('height', tested_revisions.length * 10)
                .selectAll('circle')
                .data(results)
                .enter()
                .append('circle')
                .attr('cx', result => x_scale(result.value))
                .attr('cy', result => y_scale(result.revision))
                .attr('r', 5 - 1)
                .style('fill', result => '#' + result.revision.slice(6) + 'CC')
                    .append('title')
                    .text(result => Number(result.value).toFixed(1));
            row.insertAdjacentHTML('beforeend', `<td>${domain[1]}</td>`);
            body.appendChild(row);
        });
    });
}

function showRevisions() {
    let container = document.getElementById('revs');
    revisions.forEach(function(rev) {
        let row = document.createElement('tr');
        row.insertAdjacentHTML('beforeend', `<td><a href="${HG}${tree}/rev/${rev}">${rev}</a></td>`);
        row.insertAdjacentHTML('beforeend', `<td class="color" style="background-color:#${rev.slice(6)};"></td>`);
        container.appendChild(row);
        getRevisionDesc(rev, row);
    });
}

function getRevisionDesc(rev, row) {
    function getNext(_rev) {
        fetch(`${HG}${tree}/json-rev/${_rev}`)
            .then(response => response.json())
            .then(function(details) {
                if (details.desc.indexOf('try: ') < 0) {
                    let summary = details.desc.split('\n')[0];
                    row.insertAdjacentHTML('beforeend',
                        `<td title="${details.desc}">${summary}</td>`);
                }
                else {
                    getNext(details.parents[0]);
                }
            });
    }
    getNext(rev);
}

onLoad();
