/**
 * @license Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const Audit = require('./audit');
const DevtoolsTimelineModel = require('../lib/traces/devtools-timeline-model');
const WebInspector = require('../lib/web-inspector');
const Util = require('../report/v2/renderer/util.js');

const group = {
  loading: 'Network request loading',
  parseHTML: 'Parsing DOM',
  styleLayout: 'Style & Layout',
  compositing: 'Compositing',
  painting: 'Paint',
  gpu: 'GPU',
  scripting: 'Script Evaluation',
  scriptParseCompile: 'Script Parsing & Compile',
  scriptGC: 'Garbage collection',
  other: 'Other',
  images: 'Images',
};
const taskToGroup = {
  'Animation': group.painting,
  'Async Task': group.other,
  'Frame Start': group.painting,
  'Frame Start (main thread)': group.painting,
  'Cancel Animation Frame': group.scripting,
  'Cancel Idle Callback': group.scripting,
  'Compile Script': group.scriptParseCompile,
  'Composite Layers': group.compositing,
  'Console Time': group.scripting,
  'Image Decode': group.images,
  'Draw Frame': group.painting,
  'Embedder Callback': group.scripting,
  'Evaluate Script': group.scripting,
  'Event': group.scripting,
  'Animation Frame Fired': group.scripting,
  'Fire Idle Callback': group.scripting,
  'Function Call': group.scripting,
  'DOM GC': group.scriptGC,
  'GC Event': group.scriptGC,
  'GPU': group.gpu,
  'Hit Test': group.compositing,
  'Invalidate Layout': group.styleLayout,
  'JS Frame': group.scripting,
  'Input Latency': group.scripting,
  'Layout': group.styleLayout,
  'Major GC': group.scriptGC,
  'DOMContentLoaded event': group.scripting,
  'First paint': group.painting,
  'FMP': group.painting,
  'FMP candidate': group.painting,
  'Load event': group.scripting,
  'Minor GC': group.scriptGC,
  'Paint': group.painting,
  'Paint Image': group.images,
  'Paint Setup': group.painting,
  'Parse Stylesheet': group.parseHTML,
  'Parse HTML': group.parseHTML,
  'Parse Script': group.scriptParseCompile,
  'Other': group.other,
  'Rasterize Paint': group.painting,
  'Recalculate Style': group.styleLayout,
  'Request Animation Frame': group.scripting,
  'Request Idle Callback': group.scripting,
  'Request Main Thread Frame': group.painting,
  'Image Resize': group.images,
  'Finish Loading': group.loading,
  'Receive Data': group.loading,
  'Receive Response': group.loading,
  'Send Request': group.loading,
  'Run Microtasks': group.scripting,
  'Schedule Style Recalculation': group.styleLayout,
  'Scroll': group.compositing,
  'Task': group.other,
  'Timer Fired': group.scripting,
  'Install Timer': group.scripting,
  'Remove Timer': group.scripting,
  'Timestamp': group.scripting,
  'Update Layer': group.compositing,
  'Update Layer Tree': group.compositing,
  'User Timing': group.scripting,
  'Create WebSocket': group.scripting,
  'Destroy WebSocket': group.scripting,
  'Receive WebSocket Handshake': group.scripting,
  'Send WebSocket Handshake': group.scripting,
  'XHR Load': group.scripting,
  'XHR Ready State Change': group.scripting,
};

class BootupTime extends Audit {
  /**
   * @return {!AuditMeta}
   */
  static get meta() {
    return {
      category: 'Performance',
      name: 'bootup-time',
      description: 'JavaScript boot-up time is high (> 4s)',
      failureDescription: 'JavaScript boot-up time is too high',
      helpText: 'Consider reducing the time spent parsing, compiling and executing JS. ' +
        'You may find delivering smaller JS payloads helps with this.',
      requiredArtifacts: ['traces'],
    };
  }

  /**
   * @param {!Array<TraceEvent>=} trace
   * @return {!Map<string, Number>}
   */
  static getExecutionTimingsByURL(trace) {
    const timelineModel = new DevtoolsTimelineModel(trace);
    const bottomUpByName = timelineModel.bottomUpGroupBy('URL');
    const result = new Map();

    bottomUpByName.children.forEach((perUrlNode, url) => {
      // when url is "" or about:blank, we skip it
      if (!url || url === 'about:blank') {
        return;
      }

      const tasks = {};
      perUrlNode.children.forEach((perTaskPerUrlNode) => {
        const taskGroup = WebInspector.TimelineUIUtils.eventStyle(perTaskPerUrlNode.event);
        tasks[taskGroup.title] = tasks[taskGroup.title] || 0;
        tasks[taskGroup.title] += Number((perTaskPerUrlNode.selfTime || 0).toFixed(1));
      });
      result.set(url, tasks);
    });

    return result;
  }

  /**
   * @param {!Artifacts} artifacts
   * @return {!AuditResult}
   */
  static audit(artifacts) {
    const trace = artifacts.traces[BootupTime.DEFAULT_PASS];
    const bootupTimings = BootupTime.getExecutionTimingsByURL(trace);

    let totalBootupTime = 0;
    const extendedInfo = {};
    const headings = [
      {key: 'url', itemType: 'url', text: 'URL'},
    ];

    // Group tasks per url
    const groupsPerUrl = Array.from(bootupTimings).map(([url, durations]) => {
      extendedInfo[url] = durations;

      const groups = [];
      Object.keys(durations).forEach(task => {
        totalBootupTime += durations[task];
        const group = taskToGroup[task];

        groups[group] = groups[group] || 0;
        groups[group] += durations[task];

        if (!headings.find(heading => heading.key === group)) {
          headings.push(
            {key: group, itemType: 'text', text: group}
          );
        }
      });

      return {
        url: url,
        groups,
      };
    });

    // map data in correct format to create a table
    const results = groupsPerUrl.map(({url, groups}) => {
      const res = {};
      headings.forEach(heading => {
        res[heading.key] = Util.formatMilliseconds(groups[heading.key] || 0, 1);
      });

      res.url = url;

      return res;
    });

    const tableDetails = BootupTime.makeTableDetails(headings, results);

    return {
      score: totalBootupTime < 4000,
      rawValue: totalBootupTime,
      displayValue: Util.formatMilliseconds(totalBootupTime),
      details: tableDetails,
      extendedInfo: {
        value: extendedInfo,
      },
    };
  }
}

module.exports = BootupTime;
