const { parseSchedule, hasOverlap } = require('../utils/scheduleMatcher');

function testParseSchedule() {
  console.log('Testing parseSchedule...');

  const s1 = 'Mon, Tue 08:15-09:30';
  const p1 = parseSchedule(s1);
  console.assert(p1.length === 2, 'Should parse 2 days');
  console.assert(p1[0].day === 1, 'First day should be Monday (1)');
  console.assert(p1[1].day === 2, 'Second day should be Tuesday (2)');
  console.assert(p1[0].startMin === 495, 'Start time should be 495 minutes');
  console.assert(p1[0].endMin === 570, 'End time should be 570 minutes');

  const s2 = 'Wednesday 14:00 - 16:00';
  const p2 = parseSchedule(s2);
  console.assert(p2.length === 1, 'Should parse 1 day');
  console.assert(p2[0].day === 3, 'Day should be Wednesday (3)');
  console.assert(p2[0].startMin === 840, 'Start time should be 840 minutes');
  console.assert(p2[0].endMin === 960, 'End time should be 960 minutes');

  console.log('parseSchedule tests passed!\n');
}

function testHasOverlap() {
  console.log('Testing hasOverlap...');

  // Same day, overlapping times
  console.assert(hasOverlap('Mon 08:00-10:00', 'Mon 09:00-11:00') === true, 'Should overlap (middle)');
  console.assert(hasOverlap('Mon 08:00-10:00', 'Mon 07:00-09:00') === true, 'Should overlap (start)');
  console.assert(hasOverlap('Mon 08:00-10:00', 'Mon 08:30-09:30') === true, 'Should overlap (inside)');
  console.assert(hasOverlap('Mon 09:00-10:00', 'Mon 08:00-11:00') === true, 'Should overlap (encompassing)');

  // Same day, NOT overlapping (touching)
  console.assert(hasOverlap('Mon 08:00-09:00', 'Mon 09:00-10:00') === false, 'Should NOT overlap (touching boundary)');
  console.assert(hasOverlap('Mon 09:00-10:00', 'Mon 08:00-09:00') === false, 'Should NOT overlap (touching boundary reversed)');

  // Same day, NOT overlapping (gap)
  console.assert(hasOverlap('Mon 08:00-09:00', 'Mon 10:00-11:00') === false, 'Should NOT overlap (gap)');

  // Different days, same times
  console.assert(hasOverlap('Mon 08:00-10:00', 'Tue 08:00-10:00') === false, 'Should NOT overlap (different days)');

  // Multi-day overlap
  console.assert(hasOverlap('Mon, Tue 10:00-11:00', 'Tue 10:30-11:30') === true, 'Should overlap on Tuesday');
  console.assert(hasOverlap('Mon, Wed 10:00-11:00', 'Tue, Thu 10:00-11:00') === false, 'Should NOT overlap (no common days)');

  console.log('hasOverlap tests passed!\n');
}

try {
  testParseSchedule();
  testHasOverlap();
  console.log('All unit tests for scheduleMatcher passed successfully!');
} catch (error) {
  console.error('Tests failed:', error);
  process.exit(1);
}
