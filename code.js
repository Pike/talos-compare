/* global URL, fetch, d3 */
const Treeherder = 'https://treeherder.mozilla.org/api/project/';
const HG='https://hg.mozilla.org/'
let tree = 'try';

function onLoad() {
    let search_p = new URL(document.location).searchParams;
    revisions = search_p.getAll('revision');
    tree = search_p.get('tree');
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
    Promise.all(loading).then(collectPlatforms).then(getAllValues).then(renderResults);
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

function getAllValues() {
  const results = [];
  
  let keys = Object.keys(Results);
  for (const key of keys) {
    let jobs = Results[key];
    for (let job of jobs) {
      if (raw_values.hasOwnProperty(job.job_id)) {
        continue;
      } else {
        raw_values[job.job_id] = null;
      }
      results.push(fetch(`https://treeherder.mozilla.org/api/project/${tree}/jobs/${job.job_id}/?format=json`).then(data => {
        return data.json();
      }).then(jobData => {
        return fetch(jobData.logs[0].url).then(data => data.text()).then(t => {
          let val = t.match(/PERFHERDER_DATA: (.*)/)[1];

          val = val.replace(/NaN/g, '"NaN"');

          let test_name = signatures[key].suite;
          let res = JSON.parse(val);
          raw_values[job.job_id] = {};
          for (let suite of res.suites) {
            raw_values[job.job_id][suite.name] = suite;
          }
        });
      }));
    }
  }
  return Promise.all(results);
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
        let test_results = Results[sig];
        let name = test.test||test.suite;
        if (test.test_options) {
            name += ' (' + test.test_options[0] + ')';
        }
        if (!rows.has(name)) {
            rows.set(name, new Map());
        }
        let row = rows.get(name);
        if (name == 'ts_paint (e10s)' && test.machine_platform ==='windowsxp') {
            console.log('break me')
        }
        let revs = new Set();
        let results = {};
        let avg = {};
        test_results.forEach(function(result) {
            let rev = res_ids_2_rev[result.result_set_id];
            revs.add(rev);
            let raws = raw_values[result.job_id][test.suite];
            //for (let subtests of raws.subtests) {
            let subtest = raws.subtests[0];
            let values;
            if (subtest.replicates) {
                values = subtest.replicates.map(Number).filter(n => !Number.isNaN(n));
                values.shift(); // really skip first run
            }
            else {
                values = [subtest.value];
            };
            if (!avg[rev]) {
                avg[rev] = {
                    sum: subtest.value,
                    cnt: 1
                }
                results[rev] = values
            }
            else {
                avg[rev].sum += subtest.value;
                avg[rev].cnt++;
                results[rev] = results[rev].concat(values);
            }
        });
        let values = Object.keys(results).map(rev => results[rev]).reduce((a, b) => a.concat(b));
        let min = Math.min.apply(null, values);
        let max = Math.max.apply(null, values);
        val_span = Math.max(max - min, val_span);
        for (let rev in avg) {
            avg.value = avg[rev].sum/avg[rev].cnt;
        }
        console.log(name, test.machine_platform, val_span)
        revs = revisions.filter(rev => revs.has(rev));
        row.set(test.machine_platform, {
            max: max,
            min: min,
            tested_revisions: revs,
            averages: avg,
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
            let [platform, {max, min, tested_revisions, averages, results}] = t;
            let lower_bound = Math.max(Math.floor((max + min - val_span) / 2), 0);
            let domain = [lower_bound , lower_bound + val_span];
            let row = document.createElement('tr');
            if (i === 0) {
                row.innerHTML = `<td rowspan="${platforms.length}">${label}</td>`;
            }
            row.insertAdjacentHTML('beforeend', `<td>${platform}</td>`);
            row.insertAdjacentHTML('beforeend', `<td>${domain[0]}</td>`);
            row.insertAdjacentHTML('beforeend', '<td class="graph"><svg></svg></td>');
            let histograms = [], top = 0;
            for (let rev in results) {
                let histogram = d3.histogram()
                    .domain([min, max])
                    .thresholds(50)
                    (results[rev]);
                top = Math.max(top, Math.max.apply(null, histogram.map(h => h.length)));
                histogram.rev = rev;
                let bin = [];
                bin.x0 = bin.x1 = domain[0];
                histogram.unshift(bin);
                bin = [];
                bin.x0 = bin.x1 = domain[1];
                histogram.push(bin);
                histograms.push(histogram);
            }
            let y_scale = d3.scaleLinear();
            y_scale.range([100, 0]);
            y_scale.domain([0, top]);
            let x_scale = d3.scaleLinear();
            x_scale.range([5, 795]);
            x_scale.domain(domain);
            d3.select(row).select('svg')
                .attr('width', 800)
                .attr('height', 100)
                .selectAll('path')
                .data(histograms)
                .enter()
                .append('path')
                .attr('class', 'line')
                .style('stroke', function(h) {
                    return '#' + h.rev.slice(6); //+ 'CC'
                })
                .attr('d', d3.line()
                   .curve(d3.curveMonotoneX)
                   .x(function(bin) {
                       console.log('x', bin);
                       return x_scale((bin.x0 + bin.x1)/2);
                       })
                   .y(function(bin) {
                       return y_scale(bin.length);
                       })
               );
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

collectPlatforms();
showRevisions();
//onLoad();