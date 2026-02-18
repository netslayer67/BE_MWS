function createSeed(checkinData) {
    const dateBucket = new Date().toISOString().slice(0, 10);
    const content = [
        checkinData.weatherType,
        ...(checkinData.selectedMoods || []),
        checkinData.presenceLevel,
        checkinData.capacityLevel,
        checkinData.details,
        checkinData.supportContact,
        dateBucket
    ].join('|');

    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        hash = (hash << 5) - hash + content.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function rotateArray(arr, seed) {
    if (!arr || arr.length === 0) return [];
    const rotated = [...arr];
    const shift = seed % rotated.length;
    return rotated.slice(shift).concat(rotated.slice(0, shift));
}

module.exports = {
    createSeed,
    rotateArray
};
